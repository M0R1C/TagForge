import os
import threading
from .base import BaseManager
from semantic_filter import SemanticFilter
from auto_tag import AutoTagger
from database import Database
from utils import get_caption_path, get_image_files
import shutil
import torch


class SemanticManager(BaseManager):
    def __init__(self, db: Database, tagger: AutoTagger):
        super().__init__()
        self.db = db
        self.tagger = tagger
        self.semantic_filter = None
        self._progress = {
            'total': 0, 'processed': 0, 'current_file': '',
            'suspicious_list': [], 'suspicious_count': 0,
            'bad_count': 0, 'bad_files': []
        }

    def start(self, dataset_path: str, config: dict):
        if self.is_running:
            return
        self._set_running(True)
        self._update_progress(total=0, processed=0, current_file='',
                              suspicious_list=[], suspicious_count=0,
                              bad_count=0, bad_files=[])

        thread = threading.Thread(target=self._run, args=(dataset_path, config))
        thread.daemon = True
        thread.start()

    def _run(self, dataset_path: str, config: dict):
        if self.semantic_filter is None:
            self.semantic_filter = SemanticFilter(models_dir='models')

        try:
            images = get_image_files(dataset_path)
            total = len(images)
            self._update_progress(total=total, processed=0, current_file='')

            if total == 0:
                return

            bad_folder = os.path.join(dataset_path, 'marked_as_bad')
            os.makedirs(bad_folder, exist_ok=True)

            self._preload_models(config, images, dataset_path)

            suspicious_list = []
            bad_files_with_reason = []
            auto_threshold = config.get('thresholds', {}).get('auto', 0.85)
            suspicious_threshold = config.get('thresholds', {}).get('suspicious', 0.70)

            for idx, img in enumerate(images):
                if not self.is_running:
                    break
                self._update_progress(current_file=img)
                img_path = os.path.join(dataset_path, img)
                try:
                    res = self.semantic_filter.analyze_image(
                        img_path,
                        detectors=config.get('detectors', []),
                        encoder=config.get('encoder'),
                        user_model_data=config.get('user_model_data'),
                        yolo_models=config.get('yolo_models', {}),
                        encoder_model_name=config.get('encoder_model'),
                        yolo_thresholds=config.get('yolo_thresholds', {}),
                        auto_tagger=self.tagger,
                        auto_tagger_model=config.get('auto_tagger_model'),
                        auto_tagger_threshold=config.get('auto_tagger_threshold', 0.35),
                        user_models_per_detector=config.get('user_models_per_detector', {}),
                        clip_uncertainty_margin=config.get('clip_uncertainty_margin', 0.1)
                    )
                except Exception as e:
                    reason = f"Ошибка анализа: {str(e)}"
                    self._move_to_bad(img_path, bad_folder, img, reason)
                    bad_files_with_reason.append((img, reason))
                    self._update_progress(
                        bad_count=self._progress['bad_count'] + 1,
                        bad_files=self._progress['bad_files'] + [img]
                    )
                    continue

                defect_confidence = res.get('defect_confidence', 0.0)
                report = self.semantic_filter.get_detection_report(res)

                if defect_confidence >= auto_threshold:
                    reason = f"Превышен порог автоматического отбора: defect_confidence={defect_confidence:.2f} (порог={auto_threshold})\n{report}"
                    self._move_to_bad(img_path, bad_folder, img, reason)
                    bad_files_with_reason.append((img, reason))
                    self._update_progress(
                        bad_count=self._progress['bad_count'] + 1,
                        bad_files=self._progress['bad_files'] + [img]
                    )
                elif defect_confidence >= suspicious_threshold:
                    suspicious_list.append({
                        'filename': img,
                        'detections': res['detections'],
                        'semantic_score': res.get('semantic_score'),
                        'overall_score': res.get('overall_score', 0.0),
                        'defect_confidence': defect_confidence,
                        'tags': res.get('tags', []),
                        'visual_data': res.get('visual_data', {}),
                        'expected_counts': res.get('expected_counts', {}),
                        'significant_tags': res.get('significant_tags', []),
                        'report': f"defect_confidence={defect_confidence:.2f} (порог={suspicious_threshold})\n{report}"
                    })
                    self._update_progress(suspicious_list=suspicious_list, suspicious_count=len(suspicious_list))

                self._update_progress(processed=idx + 1)

        except Exception as e:
            import logging
            logging.error(f"Semantic analysis crashed: {e}")
        finally:
            self._set_running(False)
            if self.semantic_filter is not None:
                self.semantic_filter.unload_all()
                self.semantic_filter = None
            if self.tagger is not None:
                self.tagger.unload_all()
            import gc
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    def stop(self):
        super().stop()
        if self.semantic_filter is not None:
            self.semantic_filter.unload_all()
            self.semantic_filter = None
        if self.tagger is not None:
            self.tagger.unload_all()
        import gc
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _preload_models(self, config, images, dataset_path):
        yolo_models = config.get('yolo_models', {})
        if yolo_models:
            self._update_progress(current_file='Загрузка YOLO моделей...')
            for det_name, model_path in yolo_models.items():
                if model_path:
                    try:
                        self.semantic_filter.load_yolo(model_path)
                    except Exception as e:
                        pass
        encoder = config.get('encoder')
        if encoder and images:
            self._update_progress(current_file=f'Загрузка энкодера {encoder}...')
            try:
                first_img = images[0]
                if encoder == 'clip':
                    self.semantic_filter.get_embedding_clip(os.path.join(dataset_path, first_img),
                                                            config.get('encoder_model'))
                elif encoder == 'dinov2':
                    self.semantic_filter.get_embedding_dinov2(os.path.join(dataset_path, first_img),
                                                              config.get('encoder_model'))
            except Exception:
                pass
        auto_model = config.get('auto_tagger_model')
        if auto_model:
            self._update_progress(current_file='Загрузка модели автотеггера...')
            try:
                self.tagger._load_model(auto_model)
            except Exception:
                pass

    def _move_to_bad(self, img_path, bad_folder, img, reason):
        try:
            shutil.move(img_path, os.path.join(bad_folder, img))
            txt_path = get_caption_path(img_path)
            if os.path.exists(txt_path):
                shutil.move(txt_path, os.path.join(bad_folder, os.path.basename(txt_path)))
            report_path = os.path.join(bad_folder, os.path.splitext(img)[0] + '_reason.txt')
            with open(report_path, 'w', encoding='utf-8') as f:
                f.write(f"Файл: {img}\nПричина:\n{reason}\n")
        except Exception as e:
            pass

    def get_suspicious(self):
        with self._lock:
            return self._progress.get('suspicious_list', []).copy()