import os
import hashlib
import numpy as np
from PIL import Image, ImageFilter, ImageOps, ImageChops
import imagehash
import logging

logger = logging.getLogger(__name__)

class ImageAnalyzer:
    def __init__(self):
        # Список «идеальных» разрешений для обучения (можно расширить)
        self.ideal_resolutions = [
            (1024, 1024), (832, 1216), (1216, 832),
            (768, 1024), (1024, 768),
            (768, 768), (640, 640),
            (576, 768), (768, 576),
            (512, 768), (768, 512),
            (512, 512), (1344, 768), (768, 1344),
            (1152, 896), (896, 1152)
        ]
        # Пороги для классификации артефактов и шума (опытные)
        self.blockiness_threshold = 0.15   # выше – сильные артефакты
        self.noise_threshold = 0.05        # выше – шумное изображение

    def compute_file_hash(self, filepath, algorithm='sha256'):
        """Вычисляет хэш файла (SHA256 по умолчанию)"""
        hash_func = hashlib.sha256()
        with open(filepath, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b''):
                hash_func.update(chunk)
        return hash_func.hexdigest()

    def compute_perceptual_hash(self, img, hash_size=8):
        """
        Вычисляет перцептивный хэш (pHash) из объекта PIL.Image.
        """
        try:
            img_rgb = img.convert('RGB')
            phash = imagehash.phash(img_rgb, hash_size=hash_size)
            return str(phash)
        except Exception as e:
            logger.error(f"Ошибка pHash: {e}")
            return None

    def get_image_dimensions(self, img):
        """Возвращает (width, height) из объекта PIL.Image"""
        return img.size

    # ---- Метрики качества (все принимают объект PIL.Image) ----

    def sharpness_metric(self, img):
        """
        Оценка резкости через дисперсию Лапласиана.
        Принимает объект PIL.Image.
        Возвращает число (чем больше, тем резче).
        """
        try:
            import cv2
            # Конвертируем в оттенки серого и в numpy array
            img_np = np.array(img.convert('L'))
            laplacian = cv2.Laplacian(img_np, cv2.CV_64F)
            variance = laplacian.var()
            return variance
        except ImportError:
            # fallback: используем стандартное отклонение градиентов через PIL
            img_array = np.array(img.convert('L'), dtype=np.float32)
            gradient_x = np.abs(np.diff(img_array, axis=1))
            gradient_y = np.abs(np.diff(img_array, axis=0))
            # дополним до одинаковых размеров
            if gradient_x.shape != gradient_y.shape:
                min_h = min(gradient_x.shape[0], gradient_y.shape[0])
                min_w = min(gradient_x.shape[1], gradient_y.shape[1])
                gradient_x = gradient_x[:min_h, :min_w]
                gradient_y = gradient_y[:min_h, :min_w]
            gradient_magnitude = np.sqrt(gradient_x**2 + gradient_y**2)
            return float(np.std(gradient_magnitude))
        except Exception as e:
            logger.error(f"Ошибка оценки резкости: {e}")
            return 0.0

    def jpeg_artifact_metric(self, img):
        """
        Оценка блочных артефактов JPEG.
        Принимает объект PIL.Image.
        Возвращает значение от 0 до 1 (0 – нет артефактов, 1 – сильные артефакты).
        """
        try:
            img_gray = img.convert('L')
            img_array = np.array(img_gray, dtype=np.float32)

            # Сгладим изображение медианным фильтром 3x3
            smoothed = img_gray.filter(ImageFilter.MedianFilter(size=3))
            smoothed_array = np.array(smoothed, dtype=np.float32)

            diff = np.abs(img_array - smoothed_array)

            h, w = diff.shape
            h = h - h % 8
            w = w - w % 8
            if h < 8 or w < 8:
                return 0.0
            diff = diff[:h, :w]

            block_mask = np.zeros((h, w), dtype=np.float32)
            block_mask[::8, :] = 1   # горизонтальные линии
            block_mask[:, ::8] = 1   # вертикальные линии

            boundary_mean = np.mean(diff[block_mask == 1])
            inner_mean = np.mean(diff[block_mask == 0])

            if inner_mean == 0:
                return 0.0
            ratio = boundary_mean / (inner_mean + 1e-6)
            norm_ratio = min(ratio / 3.0, 1.0)
            return norm_ratio
        except Exception as e:
            logger.error(f"Ошибка оценки JPEG артефактов: {e}")
            return 0.0

    def noise_metric(self, img):
        """
        О.
        Принимает объект PIL.Image.
        Возвращает значение от 0 до 1 (0 – без шума, 1 – сильный шум).
        """
        try:
            img_gray = img.convert('L')
            img_array = np.array(img_gray, dtype=np.float32)

            # Сглаживание Гауссом
            blurred = img_gray.filter(ImageFilter.GaussianBlur(radius=2))
            blurred_array = np.array(blurred, dtype=np.float32)

            residual = np.abs(img_array - blurred_array)

            # Простой градиент
            grad_x = np.abs(np.diff(img_array, axis=1))
            grad_y = np.abs(np.diff(img_array, axis=0))
            grad_x = np.pad(grad_x, ((0,0),(0,1)), mode='edge')
            grad_y = np.pad(grad_y, ((0,1),(0,0)), mode='edge')
            grad_mag = np.sqrt(grad_x**2 + grad_y**2)

            low_texture_mask = grad_mag < np.percentile(grad_mag, 30)

            if np.sum(low_texture_mask) == 0:
                noise_level = 0.0
            else:
                noise_level = np.mean(residual[low_texture_mask])

            norm_noise = min(noise_level / 50.0, 1.0)
            return norm_noise
        except Exception as e:
            logger.error(f"Ошибка оценки шума: {e}")
            return 0.0

    def detect_watermark(self, img):
        """
        Простейшая проверка на водяные знаки (заглушка).
        Принимает объект PIL.Image (не используется).
        """
        return False

    def resolution_score(self, width, height):
        """
        Оценка близости разрешения к идеальным значениям.
        Возвращает число от 0 до 1.
        """
        area = width * height
        best_score = 0.0
        for (iw, ih) in self.ideal_resolutions:
            ideal_area = iw * ih
            aspect = width / height if height != 0 else 0
            ideal_aspect = iw / ih
            aspect_diff = abs(aspect - ideal_aspect) / max(aspect, ideal_aspect) if aspect != 0 else 1
            aspect_score = max(0, 1 - aspect_diff)

            if area <= ideal_area:
                area_score = area / ideal_area
            else:
                ratio = area / ideal_area
                area_score = 1.0 / (1.0 + (ratio - 1.0) / 2.0)
                area_score = max(0.0, area_score)

            score = aspect_score * 0.4 + area_score * 0.6
            if score > best_score:
                best_score = score
        return best_score

    def _get_aspect_label(self, ratio):
        """Возвращает метку соотношения сторон (как в существующей функции)"""
        targets = {
            '1:1': 1.0,
            '4:3': 4/3,
            '3:4': 3/4,
            '16:9': 16/9,
            '9:16': 9/16,
            '2:3': 2/3,
            '3:2': 3/2,
            '21:9': 21/9,
            '9:21': 9/21,
        }
        best = min(targets.items(), key=lambda item: abs(ratio - item[1]))
        return best[0]

    def analyze_image(self, filepath):
        """Основной метод: вычисляет все метрики для одного файла"""
        if not os.path.isfile(filepath):
            return None

        # Хэш файла (нужен для проверки изменений)
        file_hash = self.compute_file_hash(filepath)

        # Открываем изображение один раз
        try:
            img = Image.open(filepath)
        except Exception as e:
            logger.error(f"Не удалось открыть {filepath}: {e}")
            return None

        width, height = img.size
        aspect = width / height if height != 0 else 0
        aspect_label = self._get_aspect_label(aspect)

        multiple_32 = (width % 32 == 0 and height % 32 == 0)
        multiple_64 = (width % 64 == 0 and height % 64 == 0)

        resolution_score = self.resolution_score(width, height)

        # Вычисляем метрики на оригинальном изображении
        perceptual_hash = self.compute_perceptual_hash(img)
        sharpness = self.sharpness_metric(img)
        jpeg_artifacts = self.jpeg_artifact_metric(img)
        noise_level = self.noise_metric(img)
        has_watermark = self.detect_watermark(img)

        metrics = {
            'file_hash': file_hash,
            'perceptual_hash': perceptual_hash,
            'width': width,
            'height': height,
            'aspect_ratio': aspect_label,
            'multiple_32': multiple_32,
            'multiple_64': multiple_64,
            'resolution_score': resolution_score,
            'sharpness': sharpness,
            'jpeg_artifacts': jpeg_artifacts,
            'noise_level': noise_level,
            'has_watermark': has_watermark
        }
        metrics['overall_quality'] = self.overall_quality_score(metrics)
        return metrics

    def overall_quality_score(self, metrics):
        """
        Вычисляет интегральную оценку качества от 0 до 100.
        metrics – словарь с ключами:
            sharpness, jpeg_artifacts, noise_level, resolution_score,
            multiple_32, multiple_64
        """
        sharp_norm = min(metrics['sharpness'] / 30.0, 1.0)
        no_artifacts = 1.0 - metrics['jpeg_artifacts']
        no_noise = 1.0 - metrics['noise_level']
        mult_bonus = 0.04 if (metrics['multiple_32'] or metrics['multiple_64']) else 0.0

        score = (
            0.15 * sharp_norm +
            0.08 * no_artifacts +
            0.08 * no_noise +
            0.65 * metrics['resolution_score'] +
            mult_bonus
        ) * 100

        return max(0, min(100, score))