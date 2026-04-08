import os
import threading
import concurrent.futures
import multiprocessing
from .base import BaseManager
from database import Database
from image_analyzer import ImageAnalyzer
from utils import get_file_hash


class AnalysisManager(BaseManager):
    def __init__(self, db: Database):
        super().__init__()
        self.db = db
        self._analyzer = ImageAnalyzer()
        self._progress = {'total': 0, 'processed': 0, 'current_file': ''}

    def start(self, dataset_path: str, precomputed_hashes: dict = None):
        if self.is_running:
            return
        self._set_running(True)
        self._update_progress(total=0, processed=0, current_file='Подготовка...')

        thread = threading.Thread(target=self._run, args=(dataset_path, precomputed_hashes))
        thread.daemon = True
        thread.start()

    def _run(self, dataset_path: str, precomputed_hashes: dict = None):
        from utils import get_image_files
        from database import get_image_quality, save_image_quality

        images = get_image_files(dataset_path)
        total = len(images)
        self._update_progress(total=total, processed=0, current_file='Подготовка...')

        cpu_count = multiprocessing.cpu_count()
        num_workers = max(1, min(cpu_count // 2, 8))

        def process_one(filename):
            img_path = os.path.join(dataset_path, filename)
            try:
                saved = get_image_quality(dataset_path, filename)
                current_hash = precomputed_hashes.get(filename) if precomputed_hashes is not None else None
                if current_hash is None:
                    current_hash = get_file_hash(img_path)
                if saved and saved.get('file_hash') == current_hash:
                    return filename, 'skipped'
                else:
                    metrics = self._analyzer.analyze_image(img_path)
                    if metrics:
                        save_image_quality(dataset_path, filename, metrics)
                    return filename, 'analyzed'
            except Exception as e:
                import logging
                logging.error(f"Ошибка анализа {filename}: {e}")
                return filename, 'error'

        with concurrent.futures.ThreadPoolExecutor(max_workers=num_workers) as executor:
            futures = [executor.submit(process_one, f) for f in images]
            for future in concurrent.futures.as_completed(futures):
                if not self.is_running:
                    break
                filename, status = future.result()
                self._update_progress(processed=self._progress['processed'] + 1, current_file=filename)

        try:
            from database import update_duplicate_groups, update_similar_pairs
            update_duplicate_groups(dataset_path)
            update_similar_pairs(dataset_path)
        except Exception as e:
            import logging
            logging.error(f"Ошибка обновления групп: {e}")

        self._set_running(False)
        self._update_progress(total=0, processed=0, current_file='')