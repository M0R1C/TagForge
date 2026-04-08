import os
import threading
import concurrent.futures
import multiprocessing
from PIL import Image
from .base import BaseManager
from semantic_filter import SemanticFilter
from database import get_setting


class CropManager(BaseManager):
    def __init__(self):
        super().__init__()
        self._progress = {'total': 0, 'processed': 0, 'current_file': '', 'error': None}
        self.semantic_filter = None

    def start(self, dataset_path: str, folder_name: str, model_name: str, threshold: float):
        if self.is_running:
            return
        self._set_running(True)
        self._update_progress(total=0, processed=0, current_file='', error=None)

        thread = threading.Thread(target=self._run, args=(dataset_path, folder_name, model_name, threshold))
        thread.daemon = True
        thread.start()

    def _run(self, dataset_path: str, folder_name: str, model_name: str, threshold: float):
        from utils import get_image_files

        if self.semantic_filter is None:
            self.semantic_filter = SemanticFilter(models_dir='models')

        images = get_image_files(dataset_path)
        total = len(images)
        self._update_progress(total=total, processed=0, current_file='')

        crop_dir = os.path.join(dataset_path, folder_name)
        os.makedirs(crop_dir, exist_ok=True)

        yolo_model = self.semantic_filter.load_yolo(model_name)
        class_names = yolo_model.names if hasattr(yolo_model, 'names') else {}

        batch_size = int(get_setting('batch_size', '8'))
        if batch_size < 1:
            batch_size = 1

        cpu_count = multiprocessing.cpu_count()
        max_save_workers = max(1, min(cpu_count // 2, 6))
        save_executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_save_workers)
        futures = []

        try:
            for batch_start in range(0, total, batch_size):
                if not self.is_running:
                    break
                batch_images = images[batch_start:batch_start + batch_size]
                batch_paths = [os.path.join(dataset_path, img) for img in batch_images]
                try:
                    results = yolo_model(batch_paths, conf=threshold, verbose=False)
                except Exception as e:
                    self._update_progress(error=str(e))
                    break

                for idx, (img, result) in enumerate(zip(batch_images, results)):
                    if not self.is_running:
                        break
                    self._update_progress(current_file=img)
                    try:
                        if result.boxes is None:
                            self._update_progress(processed=self._progress['processed'] + 1)
                            continue
                        pil_img = Image.open(batch_paths[idx])
                        base_name = os.path.splitext(img)[0]
                        boxes = result.boxes
                        for i, box in enumerate(boxes):
                            x1, y1, x2, y2 = box.xyxy[0].tolist()
                            conf = box.conf[0].item()
                            cls = int(box.cls[0].item())
                            x1, y1, x2, y2 = map(int, [x1, y1, x2, y2])
                            x1 = max(0, x1);
                            y1 = max(0, y1)
                            x2 = min(pil_img.width, x2);
                            y2 = min(pil_img.height, y2)
                            if x2 <= x1 or y2 <= y1:
                                continue
                            roi = pil_img.crop((x1, y1, x2, y2))
                            class_name = class_names.get(cls, f"class_{cls}")
                            conf_int = int(conf * 100)
                            crop_filename = f"{base_name}_{i + 1}_{class_name}_{conf_int}.png"
                            crop_path = os.path.join(crop_dir, crop_filename)
                            future = save_executor.submit(roi.save, crop_path, 'PNG', compress_level=0, optimize=False)
                            futures.append(future)
                    except Exception as e:
                        self._update_progress(error=str(e))
                    self._update_progress(processed=self._progress['processed'] + 1)
        except Exception as e:
            self._update_progress(error=str(e))
        finally:
            concurrent.futures.wait(futures)
            save_executor.shutdown(wait=True)
            self.semantic_filter.unload_all()
            self._set_running(False)
            self._update_progress(current_file='')