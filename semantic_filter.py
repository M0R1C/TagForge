import os
import pickle
import numpy as np
import cv2
import gc
import torch
from PIL import Image
from datetime import datetime
from typing import List, Dict, Optional, Union
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
import logging
import tempfile
from utils import get_app_temp_dir, read_image_with_opencv, write_image_with_opencv

logger = logging.getLogger(__name__)

class SemanticFilter:
    def __init__(self, models_dir='models'):
        self.models_dir = models_dir
        self.user_models_dir = os.path.join(models_dir, 'user_models')
        self.clip_models_dir = os.path.join(models_dir, 'clip')
        self.dinov2_models_dir = os.path.join(models_dir, 'dinov2')
        os.makedirs(self.user_models_dir, exist_ok=True)

        self._yolo_models = {}

        self._clip_model = None
        self._clip_processor = None
        self._clip_model_name = None
        self._dinov2_model = None
        self._dinov2_processor = None
        self._dinov2_model_name = None

        self._device = self._get_device()
        self._prompt_cache = {}

    def _get_device(self):
        if torch.cuda.is_available():
            return torch.device('cuda')
        elif hasattr(torch, 'mps') and torch.backends.mps.is_available():
            return torch.device('mps')
        else:
            return torch.device('cpu')

    def load_yolo(self, model_path: str):
        if model_path in self._yolo_models:
            return self._yolo_models[model_path]
        from ultralytics import YOLO
        if not os.path.exists(model_path):
            alt_path = os.path.join(self.models_dir, 'yolo', os.path.basename(model_path))
            if os.path.exists(alt_path):
                model_path = alt_path
            else:
                raise FileNotFoundError(f"YOLO модель не найдена: {model_path}")
        model = YOLO(model_path)
        self._yolo_models[model_path] = model
        return model

    def detect_yolo(self, image_path: str, model_path: str, class_ids: List[int], conf_threshold: float = 0.5) -> Dict:
        model = self.load_yolo(model_path)
        results = model(image_path, conf=conf_threshold)
        boxes = []
        for r in results:
            if r.boxes is not None:
                for box in r.boxes:
                    cls = int(box.cls[0])
                    if cls in class_ids:
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        conf = box.conf[0].item()
                        boxes.append([x1, y1, x2, y2, conf])
        count = len(boxes)
        avg_conf = sum(b[4] for b in boxes) / count if count else 0
        return {
            'count': count,
            'confidence': avg_conf,
            'boxes': boxes,
        }

    def detect_hands_yolo(self, image_path: str, model_path: str = None, conf_threshold: float = 0.5) -> Dict:
        if model_path is None:
            return {'count': 0, 'confidence': 0, 'boxes': []}
        return self.detect_yolo(image_path, model_path, class_ids=[0], conf_threshold=conf_threshold)

    def detect_face_yolo(self, image_path: str, model_path: str = None, conf_threshold: float = 0.5) -> Dict:
        if model_path is None:
            return {'count': 0, 'confidence': 0, 'boxes': []}
        return self.detect_yolo(image_path, model_path, class_ids=[0], conf_threshold=conf_threshold)

    def detect_eyes_yolo(self, image_path: str, model_path: str = None, conf_threshold: float = 0.5) -> Dict:
        if model_path is None:
            return {'count': 0, 'confidence': 0, 'boxes': []}
        return self.detect_yolo(image_path, model_path, class_ids=[0], conf_threshold=conf_threshold)

    def detect_feet_yolo(self, image_path: str, model_path: str = None, conf_threshold: float = 0.5) -> Dict:
        if model_path is None:
            return {'count': 0, 'confidence': 0, 'boxes': []}
        return self.detect_yolo(image_path, model_path, class_ids=[0], conf_threshold=conf_threshold)

    def _get_expected_counts_from_tags(self, tags: List[str]) -> Dict[str, Union[int, float]]:
        persons = 0
        for tag in tags:
            if tag in ('1girl', '1boy', '1other'):
                persons += 1
            elif tag == '2girls' or tag == '2boys':
                persons += 2
            elif tag == '3girls' or tag == '3boys':
                persons += 3
            elif tag == '4girls' or tag == '4boys':
                persons += 4
        if persons == 0:
            if any(tag in tags for tag in ('multiple_girls', 'multiple_boys', 'group')):
                persons = 3
            elif 'solo' in tags or 'solo_focus' in tags:
                persons = 1
        if 'no_humans' in tags:
            persons = 0
        persons = min(persons, 4)

        base_eyes = persons * 2
        if 'no_eyes' in tags or 'blindfold' in tags:
            expected_eyes = 0
        elif 'eyepatch' in tags:
            expected_eyes = base_eyes - persons
        else:
            expected_eyes = base_eyes

        base_hands = persons * 2
        if 'no_arms' in tags or 'hands_out_of_frame' in tags:
            expected_hands = 0
        elif 'one_arm' in tags:
            expected_hands = base_hands - persons
        else:
            expected_hands = base_hands

        expected_feet = 0
        feet_visible_tags = {'barefoot', 'foot_focus', 'feet', 'toes', 'soles'}
        if any(tag in tags for tag in feet_visible_tags):
            expected_feet = persons * 2
        feet_hidden_tags = {'upper_body', 'cowboy_shot', 'feet_out_of_frame', 'no_feet'}
        if any(tag in tags for tag in feet_hidden_tags):
            expected_feet = 0

        hands_penalty_factor = 1.0
        hands_partial_tags = {'arms_behind_back', 'hands_behind_back', 'arms_behind_head'}
        if any(tag in tags for tag in hands_partial_tags):
            hands_penalty_factor = 0.5

        eyes_penalty_factor = 1.0
        eyes_partial_tags = {'from_behind', 'back', 'one_eye_closed'}
        if any(tag in tags for tag in eyes_partial_tags):
            eyes_penalty_factor = 0.5

        feet_penalty_factor = 1.0

        return {
            'persons': persons,
            'expected_hands': expected_hands,
            'expected_feet': expected_feet,
            'expected_eyes': expected_eyes,
            'hands_penalty_factor': hands_penalty_factor,
            'eyes_penalty_factor': eyes_penalty_factor,
            'feet_penalty_factor': feet_penalty_factor
        }

    def _init_clip(self, model_name: str):
        from transformers import CLIPModel, CLIPProcessor, CLIPTokenizer
        self._clip_model = CLIPModel.from_pretrained(model_name)
        self._clip_processor = CLIPProcessor.from_pretrained(model_name)
        self._clip_tokenizer = CLIPTokenizer.from_pretrained(model_name)
        self._clip_model.to(self._device)
        self._clip_model.eval()
        return self._clip_model, self._clip_processor, self._clip_tokenizer

    def _get_text_embedding_clip(self, text: str, model_name: str):
        if not text:
            return np.zeros(512)

        local_path = os.path.join(self.clip_models_dir, model_name)
        if os.path.isdir(local_path):
            model_identifier = local_path
        else:
            model_identifier = model_name

        if self._clip_model is None or self._clip_model_name != model_identifier:
            self._init_clip(model_identifier)
            self._clip_model_name = model_identifier

        inputs = self._clip_tokenizer(text, return_tensors="pt", padding=True, truncation=True)
        if torch.cuda.is_available():
            inputs = {k: v.cuda() for k, v in inputs.items()}
        with torch.no_grad():
            outputs = self._clip_model.get_text_features(
                input_ids=inputs['input_ids'],
                attention_mask=inputs.get('attention_mask'),
                return_dict=True
            )
        text_features = outputs.pooler_output
        return text_features[0].cpu().numpy()

    def get_embedding_clip(self, image_path: str, model_name: str = None) -> np.ndarray:
        if model_name is None:
            model_name = 'openai/clip-vit-base-patch32'
        local_path = os.path.join(self.clip_models_dir, model_name)
        if os.path.isdir(local_path):
            model_identifier = local_path
        else:
            model_identifier = model_name

        if self._clip_model is None or self._clip_model_name != model_identifier:
            self._init_clip(model_identifier)
            self._clip_model_name = model_identifier

        img = read_image_with_opencv(image_path)
        if img is None:
            raise FileNotFoundError(f"Не удалось загрузить изображение: {image_path}")
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        image = Image.fromarray(img_rgb)

        inputs = self._clip_processor(images=image, return_tensors="pt")
        if torch.cuda.is_available():
            inputs = {k: v.cuda() for k, v in inputs.items()}
        with torch.no_grad():
            outputs = self._clip_model.get_image_features(
                pixel_values=inputs['pixel_values'],
                return_dict=True
            )
        image_features = outputs.pooler_output
        return image_features.cpu().numpy().flatten()

    def _init_dinov2(self, model_name: str):
        from transformers import AutoModel, AutoImageProcessor
        self._dinov2_model = AutoModel.from_pretrained(model_name)
        self._dinov2_processor = AutoImageProcessor.from_pretrained(model_name)
        self._dinov2_model.to(self._device)
        self._dinov2_model.eval()
        return self._dinov2_model, self._dinov2_processor

    def get_embedding_dinov2(self, image_path: str, model_name: str = None) -> np.ndarray:
        if model_name is None:
            model_name = 'facebook/dinov2-small'
        local_path = os.path.join(self.dinov2_models_dir, model_name)
        if os.path.isdir(local_path):
            model_identifier = local_path
        else:
            model_identifier = model_name

        if self._dinov2_model is None or self._dinov2_model_name != model_identifier:
            self._init_dinov2(model_identifier)
            self._dinov2_model_name = model_identifier

        img = read_image_with_opencv(image_path)
        if img is None:
            raise FileNotFoundError(f"Не удалось загрузить изображение: {image_path}")
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        image = Image.fromarray(img_rgb)

        inputs = self._dinov2_processor(images=image, return_tensors="pt")
        if torch.cuda.is_available():
            inputs = {k: v.cuda() for k, v in inputs.items()}
        with torch.no_grad():
            outputs = self._dinov2_model(**inputs)
        return outputs.last_hidden_state[:, 0, :].cpu().numpy().flatten()

    def evaluate_region(self, image_path: str, bbox: List[float], region_type: str,
                        encoder: str = 'clip', encoder_model_name: str = None) -> float:
        if encoder != 'clip':
            return 0.5

        img = read_image_with_opencv(image_path)
        if img is None:
            return 0.5

        x1, y1, x2, y2 = map(int, bbox)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(img.shape[1], x2), min(img.shape[0], y2)
        if x2 <= x1 or y2 <= y1:
            return 0.5

        roi = img[y1:y2, x1:x2]
        if roi.size == 0:
            return 0.5

        with tempfile.NamedTemporaryFile(dir=get_app_temp_dir(), suffix='.png', delete=False) as tmp:
            tmp_path = tmp.name
        write_image_with_opencv(tmp_path, roi)

        try:
            emb = self.get_embedding_clip(tmp_path, encoder_model_name)
        finally:
            os.unlink(tmp_path)

        prompts = {
            'hand': ("well-drawn hand", "poorly drawn hand"),
            'face': ("well-drawn face", "poorly drawn face"),
            'eye': ("well-drawn eye", "poorly drawn eye"),
            'foot': ("well-drawn foot", "poorly drawn foot")
        }
        good_prompt, bad_prompt = prompts.get(region_type, ("good quality", "bad quality"))

        cache_key = (encoder_model_name, good_prompt, bad_prompt)
        if cache_key not in self._prompt_cache:
            good_emb = self._get_text_embedding_clip(good_prompt, encoder_model_name)
            bad_emb = self._get_text_embedding_clip(bad_prompt, encoder_model_name)
            self._prompt_cache[cache_key] = (good_emb, bad_emb)
        else:
            good_emb, bad_emb = self._prompt_cache[cache_key]

        def cos_sim(a, b):
            return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8)

        sim_good = cos_sim(emb, good_emb)
        sim_bad = cos_sim(emb, bad_emb)
        bad_score = sim_bad / (sim_good + sim_bad + 1e-8)
        return float(bad_score)

    def train_classifier(self, good_paths: List[str], bad_paths: List[str],
                         encoder: str = 'clip', model_name: Optional[str] = None,
                         target_type: Optional[str] = None,
                         user_model_name: Optional[str] = None) -> str:
        if user_model_name is None:
            user_model_name = datetime.now().strftime('%Y%m%d_%H%M%S')
        if target_type is None:
            target_type = 'general'
        if model_name is None:
            model_name = 'default'

        good_embs = []
        for path in good_paths:
            if encoder == 'clip':
                emb = self.get_embedding_clip(path, model_name)
            else:
                emb = self.get_embedding_dinov2(path, model_name)
            good_embs.append(emb)

        bad_embs = []
        for path in bad_paths:
            if encoder == 'clip':
                emb = self.get_embedding_clip(path, model_name)
            else:
                emb = self.get_embedding_dinov2(path, model_name)
            bad_embs.append(emb)

        X = np.vstack(good_embs + bad_embs)
        y = np.array([1] * len(good_embs) + [0] * len(bad_embs))

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        clf = LogisticRegression(max_iter=1000, class_weight='balanced')
        clf.fit(X_scaled, y)

        encoder_dir = os.path.join(self.user_models_dir, encoder)
        model_dir = os.path.join(encoder_dir, model_name)
        target_dir = os.path.join(model_dir, target_type)
        os.makedirs(target_dir, exist_ok=True)

        model_path = os.path.join(target_dir, f"{user_model_name}.pkl")
        with open(model_path, 'wb') as f:
            pickle.dump({
                'clf': clf,
                'scaler': scaler,
                'encoder': encoder,
                'model_name': model_name,
                'target_type': target_type,
                'user_model_name': user_model_name,
                'created': datetime.now().isoformat()
            }, f)
        return user_model_name

    def list_user_models(self, encoder: Optional[str] = None,
                         model_name: Optional[str] = None,
                         target_type: Optional[str] = None) -> List[Dict]:
        models = []
        if not os.path.isdir(self.user_models_dir):
            return models

        for enc in os.listdir(self.user_models_dir):
            if encoder and enc != encoder:
                continue
            enc_path = os.path.join(self.user_models_dir, enc)
            if not os.path.isdir(enc_path):
                continue
            for mod in os.listdir(enc_path):
                if model_name and mod != model_name:
                    continue
                mod_path = os.path.join(enc_path, mod)
                if not os.path.isdir(mod_path):
                    continue
                for tgt in os.listdir(mod_path):
                    if target_type and tgt != target_type:
                        continue
                    tgt_path = os.path.join(mod_path, tgt)
                    if not os.path.isdir(tgt_path):
                        continue
                    for fname in os.listdir(tgt_path):
                        if fname.endswith('.pkl'):
                            model_id = f"{enc}|{mod}|{tgt}|{fname[:-4]}"
                            models.append({
                                'id': model_id,
                                'encoder': enc,
                                'model_name': mod,
                                'target_type': tgt,
                                'user_model_name': fname[:-4],
                                'created': self._get_created_time(os.path.join(tgt_path, fname))
                            })
        models.sort(key=lambda x: x.get('created', ''), reverse=True)
        return models

    def _get_created_time(self, filepath):
        try:
            with open(filepath, 'rb') as f:
                data = pickle.load(f)
                return data.get('created', '')
        except Exception:
            return ''

    def predict_with_user_model(self, image_path: str, model_data: Dict) -> float:
        encoder = model_data['encoder']
        model_name = model_data.get('model_name')
        if encoder == 'clip':
            emb = self.get_embedding_clip(image_path, model_name)
        else:
            emb = self.get_embedding_dinov2(image_path, model_name)
        emb_scaled = model_data['scaler'].transform(emb.reshape(1, -1))
        proba = model_data['clf'].predict_proba(emb_scaled)[0][1]
        return proba

    def load_user_model_by_id(self, model_id: str) -> Dict:
        parts = model_id.split('|')
        if len(parts) != 4:
            raise ValueError(f"Invalid model id: {model_id}")
        enc, mod, tgt, user_name = parts
        model_path = os.path.join(self.user_models_dir, enc, mod, tgt, f"{user_name}.pkl")
        with open(model_path, 'rb') as f:
            return pickle.load(f)

    def predict_on_roi_with_user_model(self, image_path: str, bbox: List[float],
                                       model_data: Dict) -> float:
        img = read_image_with_opencv(image_path)
        if img is None:
            return 0.5
        x1, y1, x2, y2 = map(int, bbox[:4])
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(img.shape[1], x2), min(img.shape[0], y2)
        if x2 <= x1 or y2 <= y1:
            return 0.5
        roi = img[y1:y2, x1:x2]
        if roi.size == 0:
            return 0.5
        with tempfile.NamedTemporaryFile(dir=get_app_temp_dir(), suffix='.png', delete=False) as tmp:
            tmp_path = tmp.name
        write_image_with_opencv(tmp_path, roi)
        try:
            encoder = model_data['encoder']
            model_name = model_data.get('model_name')
            if encoder == 'clip':
                emb = self.get_embedding_clip(tmp_path, model_name)
            else:
                emb = self.get_embedding_dinov2(tmp_path, model_name)
            emb_scaled = model_data['scaler'].transform(emb.reshape(1, -1))
            proba = model_data['clf'].predict_proba(emb_scaled)[0][1]
            bad_score = 1.0 - proba
            return float(bad_score)
        finally:
            os.unlink(tmp_path)

    def _filter_eyes_by_face(self, eye_boxes: List[List[float]], face_boxes: List[List[float]], buffer: int = 50) -> List[List[float]]:
        filtered = []
        for eye in eye_boxes:
            ex1, ey1, ex2, ey2 = eye[:4]
            keep = False
            for face in face_boxes:
                fx1, fy1, fx2, fy2 = face[:4]
                fx1 = max(0, fx1 - buffer)
                fy1 = max(0, fy1 - buffer)
                fx2 = fx2 + buffer
                fy2 = fy2 + buffer
                if not (ex2 < fx1 or ex1 > fx2 or ey2 < fy1 or ey1 > fy2):
                    keep = True
                    break
            if keep:
                filtered.append(eye)
        return filtered

    def analyze_image(self, image_path: str, detectors: List[str] = None,
                      encoder: str = None, user_model_data: Dict = None,
                      yolo_models: Dict[str, str] = None,
                      encoder_model_name: str = None,
                      evaluate_regions: bool = True,
                      yolo_thresholds: Dict[str, float] = None,
                      auto_tagger=None, auto_tagger_model: str = None,
                      auto_tagger_threshold: float = 0.35,
                      user_models_per_detector: Dict[str, Dict] = None,
                      clip_uncertainty_margin: float = 0.1):
        if detectors is None:
            detectors = []
        if yolo_models is None:
            yolo_models = {}
        if yolo_thresholds is None:
            yolo_thresholds = {}

        results = {'detections': {}, 'semantic_score': None, 'overall_score': 0.0, 'defect_confidence': 0.0,
                   'visual_data': {}, 'tags': []}

        tags = []
        if auto_tagger is not None and auto_tagger_model:
            try:
                tags = auto_tagger.tag_image(image_path, auto_tagger_model, auto_tagger_threshold)
                results['tags'] = tags
            except Exception as e:
                logger.error(f"Ошибка автотеггера: {e}")

        expected = self._get_expected_counts_from_tags(tags)
        expected_hands = expected['expected_hands']
        expected_feet = expected['expected_feet']
        expected_eyes = expected['expected_eyes']
        hands_penalty = expected['hands_penalty_factor']
        eyes_penalty = expected['eyes_penalty_factor']
        feet_penalty = expected['feet_penalty_factor']

        detections = {}
        quality_scores = {}

        if 'hands_yolo' in detectors:
            model_path = yolo_models.get('hands_yolo')
            thr = yolo_thresholds.get('hands_yolo', 0.5)
            res_det = self.detect_hands_yolo(image_path, model_path, conf_threshold=thr)
            detections['hands'] = res_det
            results['detections']['hands_yolo'] = res_det
            if res_det.get('boxes'):
                results['visual_data']['hands'] = {'boxes': res_det['boxes']}

        if 'face_yolo' in detectors:
            model_path = yolo_models.get('face_yolo')
            thr = yolo_thresholds.get('face_yolo', 0.5)
            res_det = self.detect_face_yolo(image_path, model_path, conf_threshold=thr)
            detections['face'] = res_det
            results['detections']['face_yolo'] = res_det
            if res_det.get('boxes'):
                results['visual_data']['face'] = {'boxes': res_det['boxes']}

        if 'eyes_yolo' in detectors:
            model_path = yolo_models.get('eyes_yolo')
            thr = yolo_thresholds.get('eyes_yolo', 0.5)
            res_det = self.detect_eyes_yolo(image_path, model_path, conf_threshold=thr)
            detections['eyes'] = res_det
            results['detections']['eyes_yolo'] = res_det
            if res_det.get('boxes'):
                results['visual_data']['eyes'] = {'boxes': res_det['boxes']}

        if 'feet_yolo' in detectors:
            model_path = yolo_models.get('feet_yolo')
            thr = yolo_thresholds.get('feet_yolo', 0.5)
            res_det = self.detect_feet_yolo(image_path, model_path, conf_threshold=thr)
            detections['feet'] = res_det
            results['detections']['feet_yolo'] = res_det
            if res_det.get('boxes'):
                results['visual_data']['feet'] = {'boxes': res_det['boxes']}

        if 'face' in detections and 'eyes' in detections and detections['face'].get('boxes') and detections['eyes'].get(
                'boxes'):
            face_boxes = detections['face']['boxes']
            eye_boxes = detections['eyes']['boxes']
            filtered_eyes = self._filter_eyes_by_face(eye_boxes, face_boxes)
            if len(filtered_eyes) != len(eye_boxes):
                detections['eyes']['boxes'] = filtered_eyes
                detections['eyes']['count'] = len(filtered_eyes)
                results['visual_data']['eyes']['boxes'] = filtered_eyes
                results['detections']['eyes_yolo']['count'] = len(filtered_eyes)

        region_scores_data = []
        for part in ['hands', 'face', 'eyes', 'feet']:
            if part not in detections:
                continue
            det = detections[part]
            if not det.get('boxes'):
                continue
            region_type_map = {
                'hands': 'hand',
                'face': 'face',
                'eyes': 'eye',
                'feet': 'foot'
            }
            region_type = region_type_map[part]
            user_model = user_models_per_detector.get(f'{part}_yolo') if user_models_per_detector else None
            scores_list = []
            for idx, box in enumerate(det['boxes']):
                if user_model:
                    bad_score = self.predict_on_roi_with_user_model(image_path, box[:4], user_model)
                else:
                    bad_score = self.evaluate_region(image_path, box[:4], region_type, encoder, encoder_model_name)
                    if clip_uncertainty_margin > 0:
                        half = clip_uncertainty_margin / 2
                        low = 0.5 - half
                        high = 0.5 + half
                        if low <= bad_score <= high:
                            continue
                scores_list.append(bad_score)
                region_scores_data.append({
                    'detector': f'{part}_yolo',
                    'box': box[:4],
                    'region_score': bad_score,
                    'confidence': box[4] if len(box) > 4 else None,
                    'index': idx + 1
                })
            if scores_list:
                quality_scores[part] = scores_list
                results['visual_data'][f'{part}_quality'] = scores_list

        if region_scores_data:
            results['visual_data']['region_scores'] = region_scores_data

        max_raw_bad_score = 0.0
        if region_scores_data:
            max_raw_bad_score = max(r['region_score'] for r in region_scores_data)

        scores_by_name = {}

        if 'hands' in detections:
            hands_det = detections['hands']
            count = hands_det.get('count', 0)
            exp = expected_hands
            if count == 0:
                count_score = 0.0
            else:
                if count == exp:
                    count_score = 0.0
                elif count < exp:
                    deficit = exp - count
                    deficit_penalty = 0.2 * (deficit / exp) * hands_penalty
                    count_score = deficit_penalty
                else:
                    excess = count - exp
                    count_score = min(1.0, 0.3 * excess)
            if count > 0 and 'hands' in quality_scores and quality_scores['hands']:
                avg_quality = np.mean(quality_scores['hands'])
                quality_score = avg_quality
            else:
                quality_score = 0.0
            if count > 0:
                total_score = min(1.0, count_score + quality_score)
                scores_by_name['hands'] = total_score

        if 'feet' in detections:
            feet_det = detections['feet']
            count = feet_det.get('count', 0)
            exp = expected_feet
            if count == 0:
                count_score = 0.0
            else:
                if count == exp:
                    count_score = 0.0
                elif count < exp:
                    deficit = exp - count
                    deficit_penalty = 0.2 * (deficit / exp) * feet_penalty
                    count_score = deficit_penalty
                else:
                    excess = count - exp
                    count_score = min(1.0, 0.3 * excess)
            if count > 0 and 'feet' in quality_scores and quality_scores['feet']:
                avg_quality = np.mean(quality_scores['feet'])
                quality_score = avg_quality
            else:
                quality_score = 0.0
            if count > 0:
                total_score = min(1.0, count_score + quality_score)
                scores_by_name['feet'] = total_score

        if 'face' in detections:
            face_det = detections['face']
            count = face_det.get('count', 0)
            if count > 0 and 'face' in quality_scores and quality_scores['face']:
                avg_quality = np.mean(quality_scores['face'])
                scores_by_name['face'] = avg_quality

        if 'eyes' in detections:
            eyes_det = detections['eyes']
            count = eyes_det.get('count', 0)
            exp = expected_eyes
            if count > 0 and 'eyes' in quality_scores and quality_scores['eyes']:
                avg_quality = np.mean(quality_scores['eyes'])
                if count == exp:
                    count_penalty = 0.0
                elif count < exp:
                    deficit = exp - count
                    count_penalty = 0.2 * (deficit / exp) * eyes_penalty
                else:
                    excess = count - exp
                    count_penalty = min(1.0, 0.3 * excess)
                scores_by_name['eyes'] = min(1.0, avg_quality + count_penalty)
            else:
                scores_by_name['eyes'] = 0.0

        if encoder and user_model_data:
            try:
                proba = self.predict_with_user_model(image_path, user_model_data)
                results['semantic_score'] = proba
                semantic_bad_score = 1.0 - proba
                scores_by_name['semantic'] = semantic_bad_score
            except Exception as e:
                logger.error(f"Ошибка семантической оценки: {e}")

        if tags:
            if any(tag in tags for tag in ['cover one eye', 'closed eyes', 'one eye closed']):
                if 'eyes' in scores_by_name:
                    scores_by_name['eyes'] = 0.0
            if any(tag in tags for tag in ['multiple girls', 'group', '2girls', '3girls', '2boys', '3boys']):
                if 'hands' in scores_by_name:
                    scores_by_name['hands'] /= 2

        all_scores = list(scores_by_name.values())
        if all_scores:
            defect_confidence = max(all_scores)
            if max_raw_bad_score >= 0.85:
                defect_confidence = max(defect_confidence, max_raw_bad_score)
            avg_bad = sum(all_scores) / len(all_scores)
            overall_score = 1.0 - avg_bad
        else:
            defect_confidence = 0.0
            overall_score = 1.0
            if max_raw_bad_score >= 0.85:
                defect_confidence = max_raw_bad_score
                overall_score = 1.0 - max_raw_bad_score

        results['defect_confidence'] = defect_confidence
        results['overall_score'] = overall_score
        results['expected_counts'] = {
            'hands': expected_hands,
            'feet': expected_feet,
            'eyes': expected_eyes,
            'face': expected['persons']
        }
        significant_tag_set = {
            '1girl', '1boy', '1other', '2girls', '2boys', '3girls', '3boys', '4girls', '4boys',
            'multiple_girls', 'multiple_boys', 'group', 'solo', 'solo_focus', 'no_humans',
            'no_eyes', 'blindfold', 'eyepatch', 'no_arms', 'hands_out_of_frame', 'one_arm',
            'barefoot', 'foot_focus', 'feet', 'toes', 'soles', 'upper_body', 'cowboy_shot',
            'feet_out_of_frame', 'no_feet', 'arms_behind_back', 'hands_behind_back', 'arms_behind_head',
            'from_behind', 'back', 'one_eye_closed', 'cover one eye', 'closed eyes', 'one eye closed'
        }
        significant_tags = [tag for tag in tags if tag in significant_tag_set]
        results['significant_tags'] = significant_tags

        return results

    def get_detection_report(self, res: Dict) -> str:
        lines = []
        for det_name, det_res in res['detections'].items():
            if 'score' in det_res:
                score = det_res['score']
                if 'count' in det_res:
                    lines.append(
                        f"{det_name}: score={score:.2f} (count={det_res['count']}, confidence={det_res.get('confidence', 0):.2f})")
                else:
                    lines.append(f"{det_name}: score={score:.2f}")

        if 'visual_data' in res and 'region_scores' in res['visual_data']:
            region_by_detector = {}
            for r in res['visual_data']['region_scores']:
                detector = r['detector']
                region_by_detector.setdefault(detector, []).append(r)

            for detector, regions in region_by_detector.items():
                lines.append(f"\n{detector} quality assessment:")
                for idx, reg in enumerate(regions, 1):
                    quality_text = "плохое" if reg['region_score'] > 0.5 else "хорошее"
                    confidence = reg.get('confidence', None)
                    conf_str = f", conf={confidence:.2f}" if confidence is not None else ""
                    lines.append(f"  {detector} #{idx}: {quality_text} (score={reg['region_score']:.2f}{conf_str})")

        if res.get('semantic_score') is not None:
            lines.append(
                f"\nsemantic: good_prob={res['semantic_score']:.2f}, bad_score={1.0 - res['semantic_score']:.2f}")

        if res.get('defect_confidence') is not None:
            lines.append(f"\ndefect_confidence (уверенность в дефекте): {res['defect_confidence']:.2f}")
        if res.get('overall_score') is not None:
            lines.append(f"overall_quality (общее качество): {res['overall_score']:.2f}")

        return '\n'.join(lines)

    def unload_all(self):
        # YOLO
        self._yolo_models.clear()
        # CLIP
        self._clip_model = None
        self._clip_processor = None
        self._clip_tokenizer = None
        self._clip_model_name = None
        # DINOv2
        self._dinov2_model = None
        self._dinov2_processor = None
        self._dinov2_model_name = None
        # Кэш промптов
        self._prompt_cache.clear()
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        logger.info("Все модели SemanticFilter выгружены, GPU память очищена")

    def detect_all_yolo(self, image_path: str, model_path: str, conf_threshold: float = 0.5) -> List[Dict]:
        model = self.load_yolo(model_path)
        results = model(image_path, conf=conf_threshold)
        detections = []
        for r in results:
            if r.boxes is not None:
                for box in r.boxes:
                    cls = int(box.cls[0])
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    conf = box.conf[0].item()
                    detections.append({
                        'class_id': cls,
                        'bbox': [x1, y1, x2, y2],
                        'confidence': conf
                    })
        return detections