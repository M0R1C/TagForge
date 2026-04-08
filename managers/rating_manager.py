import os
import threading
import concurrent.futures
import multiprocessing
from .base import BaseManager
from auto_tag import AutoTagger
from database import Database, get_setting, get_image_rating_and_hash, save_image_rating
from utils import get_file_hash, get_image_files


class RatingManager(BaseManager):
    def __init__(self, db: Database, tagger: AutoTagger):
        super().__init__()
        self.db = db
        self.tagger = tagger
        self._progress = {'total': 0, 'processed': 0, 'current_file': '', 'dataset_path': None}
        self.RATING_MODEL = "wd-swinv2-tagger-v3"

    def start(self, dataset_path: str, precomputed_hashes: dict = None):
        if self.is_running:
            return
        self._set_running(True)
        self._update_progress(total=0, processed=0, current_file='', dataset_path=dataset_path)

        thread = threading.Thread(target=self._run, args=(dataset_path, precomputed_hashes))
        thread.daemon = True
        thread.start()

    def _run(self, dataset_path: str, precomputed_hashes: dict = None):
        images = get_image_files(dataset_path)
        total = len(images)
        self._update_progress(total=total, processed=0, current_file='')

        batch_size = int(get_setting('batch_size', '8'))
        if batch_size < 1:
            batch_size = 1

        cpu_count = multiprocessing.cpu_count()
        preprocess_workers = max(1, min(cpu_count // 2, 6))

        to_process = []
        for idx, img in enumerate(images):
            img_path = os.path.join(dataset_path, img)
            current_hash = precomputed_hashes.get(img) if precomputed_hashes is not None else None
            if current_hash is None:
                try:
                    current_hash = get_file_hash(img_path)
                except Exception:
                    current_hash = None
            saved_rating, saved_hash = get_image_rating_and_hash(dataset_path, img)
            if saved_hash and saved_hash == current_hash:
                self._update_progress(processed=idx + 1)
                continue
            to_process.append((idx, img, img_path, current_hash))

        if not to_process:
            self._set_running(False)
            return

        try:
            self.tagger._load_model(self.RATING_MODEL)
        except Exception as e:
            self._update_progress(error=str(e))
            self._set_running(False)
            return

        with concurrent.futures.ThreadPoolExecutor(max_workers=preprocess_workers) as executor:
            next_future = None
            for batch_start in range(0, len(to_process), batch_size):
                batch = to_process[batch_start:batch_start + batch_size]
                batch_paths = [item[2] for item in batch]
                batch_filenames = [item[1] for item in batch]
                batch_hashes = [item[3] for item in batch]

                self._update_progress(current_file=batch_filenames[0] if batch_filenames else '')

                if next_future is not None:
                    try:
                        batch_tensors = next_future.result()
                    except Exception:
                        batch_tensors = [None] * len(batch_paths)
                else:
                    batch_tensors = self.tagger.preprocess_batch(batch_paths, self.RATING_MODEL)

                next_batch_start = batch_start + batch_size
                if next_batch_start < len(to_process):
                    next_batch = to_process[next_batch_start:next_batch_start + batch_size]
                    next_paths = [item[2] for item in next_batch]
                    next_future = executor.submit(self.tagger.preprocess_batch, next_paths, self.RATING_MODEL)
                else:
                    next_future = None

                try:
                    ratings = self.tagger.get_ratings_from_tensors(batch_tensors, self.RATING_MODEL, batch_size)
                except Exception:
                    ratings = ['general'] * len(batch_paths)

                for i, filename in enumerate(batch_filenames):
                    rating = ratings[i] if i < len(ratings) else 'general'
                    save_image_rating(dataset_path, filename, rating, batch_hashes[i])

                last_idx = batch[-1][0] if batch else -1
                self._update_progress(processed=last_idx + 1)

        self._set_running(False)
        self.tagger.unload_all()