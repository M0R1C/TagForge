import os
import numpy as np
import onnxruntime as ort
from PIL import Image
import csv
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AutoTagger:
    def __init__(self, models_dir='models'):
        self.models_dir = models_dir
        self.sessions = {}
        self.labels = {}
        self.input_shapes = {}
        self.layouts = {}
        self.input_sizes = {}
        self.model_errors = {}
        self.rating_indices = {}

    def list_models(self):
        if not os.path.isdir(self.models_dir):
            return []
        models = []
        for name in os.listdir(self.models_dir):
            model_path = os.path.join(self.models_dir, name, 'model.onnx')
            csv_path = os.path.join(self.models_dir, name, 'selected_tags.csv')
            if os.path.isfile(model_path) and os.path.isfile(csv_path):
                models.append(name)
        return models

    def _load_tags(self, csv_path):
        tags = []
        categories = []
        with open(csv_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        first_line = next((line.strip() for line in lines if line.strip()), '')
        if ',' not in first_line:
            for line in lines:
                line = line.strip()
                if line and not line.startswith('#'):
                    tags.append(line)
            logger.info(f"Загружено {len(tags)} тегов (простой список) из {csv_path}")
            return tags, []

        with open(csv_path, 'r', encoding='utf-8') as f:
            sample = f.read(1024)
            f.seek(0)
            try:
                dialect = csv.Sniffer().sniff(sample)
            except Exception:
                dialect = csv.excel
            reader = csv.reader(f, dialect)
            rows = list(reader)

        if not rows:
            return tags, categories

        first_row = rows[0]
        has_header = False
        if len(first_row) >= 2:
            col0 = first_row[0].strip().lower()
            col1 = first_row[1].strip().lower()
            if col0 in ('tag_id', 'id', 'index') or col1 == 'name':
                has_header = True

        if has_header:
            rows = rows[1:]

        for row in rows:
            if not row:
                continue
            if len(row) >= 2:
                tag = row[1].strip()
            else:
                tag = row[0].strip()
            if tag:
                tags.append(tag)
                category = None
                if len(row) >= 3:
                    try:
                        category = int(row[2])
                    except:
                        pass
                categories.append(category)

        logger.info(f"Загружено {len(tags)} тегов (CSV) из {csv_path}")
        return tags, categories

    def _load_model(self, model_name):
        if model_name in self.sessions:
            return True
        if model_name in self.model_errors:
            return False

        model_path = os.path.join(self.models_dir, model_name, 'model.onnx')
        csv_path = os.path.join(self.models_dir, model_name, 'selected_tags.csv')

        try:
            if not os.path.exists(model_path):
                raise FileNotFoundError(f"Файл модели не найден: {model_path}")
            if not os.path.exists(csv_path):
                raise FileNotFoundError(f"Файл с тегами не найден: {csv_path}")

            tags, categories = self._load_tags(csv_path)
            if not tags:
                raise ValueError("Не удалось загрузить ни одного тега.")

            rating_indices = [i for i, cat in enumerate(categories) if cat == 9] if categories else []

            providers_to_try = [
                ['DmlExecutionProvider', 'CPUExecutionProvider'],
                ['CPUExecutionProvider']
            ]

            session = None
            used_providers = None
            for providers in providers_to_try:
                try:
                    session = ort.InferenceSession(model_path, providers=providers)
                    available_providers = session.get_providers()
                    logger.info(f"Фактически используемые провайдеры: {available_providers}")
                    if 'DmlExecutionProvider' in available_providers:
                        logger.info("Используется GPU (DirectML)")
                    elif 'CUDAExecutionProvider' in available_providers:
                        logger.info("Используется GPU (CUDA)")
                    else:
                        logger.info("Используется CPU")
                    break
                except Exception as e:
                    logger.debug(f"Не удалось создать сессию с провайдерами {providers}: {e}")
                    continue

            if session is None:
                raise RuntimeError("Не удалось создать сессию ни с одним провайдером.")

            input_info = session.get_inputs()[0]
            shape = input_info.shape

            if len(shape) == 4:
                if shape[1] in (1, 3):
                    layout = 'NCHW'
                    input_size = shape[2]
                elif shape[3] in (1, 3):
                    layout = 'NHWC'
                    input_size = shape[1]
                else:
                    layout = 'NCHW'
                    input_size = shape[2] if shape[2] == shape[3] else max(shape[2], shape[3])
            else:
                layout = 'NCHW'
                input_size = 448

            logger.info(f"Модель {model_name} загружена: layout={layout}, size={input_size}, тегов={len(tags)}")

            self.sessions[model_name] = session
            self.labels[model_name] = tags
            self.input_shapes[model_name] = shape
            self.layouts[model_name] = layout
            self.input_sizes[model_name] = input_size
            self.rating_indices[model_name] = rating_indices

            return True

        except Exception as e:
            logger.error(f"Не удалось загрузить модель {model_name}: {e}", exc_info=True)
            self.model_errors[model_name] = str(e)
            self.sessions.pop(model_name, None)
            self.labels.pop(model_name, None)
            self.input_shapes.pop(model_name, None)
            self.layouts.pop(model_name, None)
            self.input_sizes.pop(model_name, None)
            self.rating_indices.pop(model_name, None)
            return False

    def preprocess(self, image_path, model_name):
        if model_name not in self.input_sizes:
            raise ValueError(f"Модель {model_name} не загружена")
        target_size = self.input_sizes[model_name]

        img = Image.open(image_path).convert('RGBA')
        background = Image.new('RGBA', img.size, (255, 255, 255, 255))
        background.alpha_composite(img)
        img = background.convert('RGB')

        w, h = img.size
        max_dim = max(w, h)
        pad_left = (max_dim - w) // 2
        pad_top = (max_dim - h) // 2
        padded = Image.new('RGB', (max_dim, max_dim), (255, 255, 255))
        padded.paste(img, (pad_left, pad_top))

        if max_dim != target_size:
            padded = padded.resize((target_size, target_size), Image.BICUBIC)

        img_array = np.array(padded, dtype=np.float32)
        img_array = img_array[:, :, ::-1]
        img_array = np.expand_dims(img_array, axis=0)
        return img_array

    def _align_output_with_tags(self, probs, tags):
        len_probs = len(probs)
        len_tags = len(tags)
        if len_probs == len_tags:
            return probs, tags
        if len_probs == len_tags - 1:
            if tags[0].startswith("rating:"):
                logger.info("Отбрасываем первый тег (rating), т.к. модель его не предсказывает")
                return probs, tags[1:]
            else:
                logger.warning(f"Длина вероятностей ({len_probs}) на 1 меньше длины тегов ({len_tags}). Отбрасываем последний тег.")
                return probs, tags[:-1]
        if len_probs == len_tags + 1:
            logger.warning(f"Длина вероятностей ({len_probs}) на 1 больше длины тегов ({len_tags}). Отбрасываем первую вероятность.")
            return probs[1:], tags
        logger.warning(f"Длина вероятностей ({len_probs}) != тегов ({len_tags}). Обрезаем до минимума.")
        min_len = min(len_probs, len_tags)
        return probs[:min_len], tags[:min_len]

    def tag_image(self, image_path, model_name, threshold=0.5):
        logger.debug(f"tag_image({image_path}, {model_name})")
        if model_name not in self.sessions:
            success = self._load_model(model_name)
            if not success:
                raise RuntimeError(f"Модель {model_name} недоступна: {self.model_errors.get(model_name, 'неизвестная ошибка')}")

        try:
            input_img = self.preprocess(image_path, model_name)
            session = self.sessions[model_name]
            input_name = session.get_inputs()[0].name
            outputs = session.run(None, {input_name: input_img})
            probs = outputs[0].flatten()
            tags = self.labels[model_name]

            probs, tags = self._align_output_with_tags(probs, tags)

            if np.any(probs < 0):
                logger.debug("Применяем сигмоиду, т.к. обнаружены отрицательные значения (логиты)")
                probs = 1.0 / (1.0 + np.exp(-probs))

            if len(probs) != len(tags):
                min_len = min(len(probs), len(tags))
                probs = probs[:min_len]
                tags = tags[:min_len]

            results = []
            for i in range(len(tags)):
                if probs[i] >= threshold:
                    tag = tags[i]
                    if not tag.startswith('rating:'):
                        tag = tag.replace('_', ' ')
                    results.append((tag, float(probs[i])))

            results.sort(key=lambda x: x[1], reverse=True)
            logger.debug(f"Найдено {len(results)} тегов выше порога {threshold}")
            return [tag for tag, _ in results]

        except Exception as e:
            logger.error(f"Ошибка при обработке {image_path}: {e}", exc_info=True)
            raise

    def get_rating(self, image_path, model_name):
        if model_name not in self.sessions:
            success = self._load_model(model_name)
            if not success:
                raise RuntimeError(f"Модель {model_name} недоступна: {self.model_errors.get(model_name, 'неизвестная ошибка')}")

        rating_indices = self.rating_indices.get(model_name, [])
        if not rating_indices:
            logger.warning(f"Модель {model_name} не содержит рейтингов (категория 9). Возвращаем 'general'.")
            return 'general'

        try:
            input_img = self.preprocess(image_path, model_name)
            session = self.sessions[model_name]
            input_name = session.get_inputs()[0].name
            outputs = session.run(None, {input_name: input_img})
            probs = outputs[0].flatten()
            tags = self.labels[model_name]

            probs, tags = self._align_output_with_tags(probs, tags)

            if np.any(probs < 0):
                probs = 1.0 / (1.0 + np.exp(-probs))

            rating_probs = [(tags[i], probs[i]) for i in rating_indices if i < len(probs)]
            if not rating_probs:
                return 'general'

            best_tag, best_prob = max(rating_probs, key=lambda x: x[1])
            rating_part = best_tag.split(':')[-1].lower()
            if rating_part in ('general', 'sensitive', 'questionable', 'explicit'):
                return rating_part
            else:
                return 'general'

        except Exception as e:
            logger.error(f"Ошибка при получении рейтинга для {image_path}: {e}")
            return 'general'
