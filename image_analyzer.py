import os
import hashlib
import numpy as np
from PIL import Image, ImageFilter
import imagehash
import logging

logger = logging.getLogger(__name__)

class ImageAnalyzer:
    def __init__(self):
        self.ideal_resolutions = [
            (1024, 1024), (832, 1216), (1216, 832),
            (768, 1024), (1024, 768),
            (768, 768), (640, 640),
            (576, 768), (768, 576),
            (512, 768), (768, 512),
            (512, 512), (1344, 768), (768, 1344),
            (1152, 896), (896, 1152)
        ]
        self.blockiness_threshold = 0.15
        self.noise_threshold = 0.05

    def compute_file_hash(self, filepath, algorithm='sha256'):
        hash_func = hashlib.sha256()
        with open(filepath, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b''):
                hash_func.update(chunk)
        return hash_func.hexdigest()

    def compute_perceptual_hash(self, img, hash_size=8):
        try:
            img_rgb = img.convert('RGB')
            phash = imagehash.phash(img_rgb, hash_size=hash_size)
            return str(phash)
        except Exception as e:
            logger.error(f"Ошибка pHash: {e}")
            return None

    def get_image_dimensions(self, img):
        return img.size

    def sharpness_metric(self, gray_np):
        try:
            import cv2
            laplacian = cv2.Laplacian(gray_np, cv2.CV_64F)
            variance = laplacian.var()
            return variance
        except ImportError:
            gray_float = gray_np.astype(np.float32)
            gradient_x = np.abs(np.diff(gray_float, axis=1))
            gradient_y = np.abs(np.diff(gray_float, axis=0))
            min_h = min(gradient_x.shape[0], gradient_y.shape[0])
            min_w = min(gradient_x.shape[1], gradient_y.shape[1])
            gradient_x = gradient_x[:min_h, :min_w]
            gradient_y = gradient_y[:min_h, :min_w]
            gradient_magnitude = np.sqrt(gradient_x**2 + gradient_y**2)
            return float(np.std(gradient_magnitude))
        except Exception as e:
            logger.error(f"Ошибка оценки резкости: {e}")
            return 0.0

    def jpeg_artifact_metric(self, gray_np):
        try:
            import cv2
            smoothed = cv2.medianBlur(gray_np, 3)
            diff = np.abs(gray_np.astype(np.float32) - smoothed.astype(np.float32))

            h, w = diff.shape
            h = h - h % 8
            w = w - w % 8
            if h < 8 or w < 8:
                return 0.0
            diff = diff[:h, :w]

            block_mask = np.zeros((h, w), dtype=np.float32)
            block_mask[::8, :] = 1
            block_mask[:, ::8] = 1

            boundary_mean = np.mean(diff[block_mask == 1])
            inner_mean = np.mean(diff[block_mask == 0])

            if inner_mean == 0:
                return 0.0
            ratio = boundary_mean / (inner_mean + 1e-6)
            norm_ratio = min(ratio / 3.0, 1.0)
            return norm_ratio
        except ImportError:
            img_pil = Image.fromarray(gray_np)
            smoothed_pil = img_pil.filter(ImageFilter.MedianFilter(size=3))
            smoothed_np = np.array(smoothed_pil, dtype=np.float32)
            diff = np.abs(gray_np.astype(np.float32) - smoothed_np)
            h, w = diff.shape
            h = h - h % 8
            w = w - w % 8
            if h < 8 or w < 8:
                return 0.0
            diff = diff[:h, :w]
            block_mask = np.zeros((h, w), dtype=np.float32)
            block_mask[::8, :] = 1
            block_mask[:, ::8] = 1
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

    def noise_metric(self, gray_np):
        try:
            import cv2
            blurred = cv2.GaussianBlur(gray_np, (0, 0), sigmaX=2, sigmaY=2)
            residual = np.abs(gray_np.astype(np.float32) - blurred.astype(np.float32))

            grad_x = cv2.Sobel(gray_np, cv2.CV_64F, 1, 0, ksize=3)
            grad_y = cv2.Sobel(gray_np, cv2.CV_64F, 0, 1, ksize=3)
            grad_mag = np.sqrt(grad_x**2 + grad_y**2)

            low_texture_mask = grad_mag < np.percentile(grad_mag, 30)

            if np.sum(low_texture_mask) == 0:
                noise_level = 0.0
            else:
                noise_level = np.mean(residual[low_texture_mask])

            norm_noise = min(noise_level / 50.0, 1.0)
            return norm_noise
        except ImportError:
            img_pil = Image.fromarray(gray_np)
            blurred_pil = img_pil.filter(ImageFilter.GaussianBlur(radius=2))
            blurred_np = np.array(blurred_pil, dtype=np.float32)
            residual = np.abs(gray_np.astype(np.float32) - blurred_np)
            grad_x = np.abs(np.diff(gray_np, axis=1))
            grad_y = np.abs(np.diff(gray_np, axis=0))
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
        return False

    def resolution_score(self, width, height):
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
        if not os.path.isfile(filepath):
            return None

        file_hash = self.compute_file_hash(filepath)

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

        perceptual_hash = self.compute_perceptual_hash(img)

        gray_img = img.convert('L')
        gray_np = np.array(gray_img, dtype=np.uint8)

        sharpness = self.sharpness_metric(gray_np)
        jpeg_artifacts = self.jpeg_artifact_metric(gray_np)
        noise_level = self.noise_metric(gray_np)
        has_watermark = self.detect_watermark(img)  # пока заглушка

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
