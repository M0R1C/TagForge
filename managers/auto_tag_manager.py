import os
import threading
import concurrent.futures
import multiprocessing
from .base import BaseManager
from auto_tag import AutoTagger
from database import Database, get_setting
from utils import get_caption_path, read_caption, write_caption, format_tags


class AutoTagManager(BaseManager):
    def __init__(self, db: Database, tagger: AutoTagger):
        super().__init__()
        self.db = db
        self.tagger = tagger
        self._progress = {
            'total': 0, 'processed': 0, 'current_file': '',
            'model_name': '', 'loading_model': False, 'error': None
        }

    def start(self, dataset_path: str, model: str, threshold: float, mode: str):
        if self.is_running:
            return
        self._set_running(True)
        self._update_progress(total=0, processed=0, current_file='', model_name=model,
                              loading_model=True, error=None)

        initial_batch_size = int(get_setting('batch_size', '8'))
        if initial_batch_size < 1:
            initial_batch_size = 1

        thread = threading.Thread(target=self._run, args=(dataset_path, model, threshold, mode, initial_batch_size))
        thread.daemon = True
        thread.start()

    def _run(self, dataset_path: str, model: str, threshold: float, mode: str, batch_size: int):
        from utils import get_image_files

        images = get_image_files(dataset_path)
        total = len(images)
        self._update_progress(total=total, processed=0, model_name=model, loading_model=True)

        try:
            self.tagger._load_model(model)
        except Exception as e:
            self._update_progress(loading_model=False, error=f"Ошибка загрузки модели: {e}")
            self._set_running(False)
            return
        self._update_progress(loading_model=False, current_file='Подготовка к обработке...')

        cpu_count = multiprocessing.cpu_count()
        async_workers = max(1, min(cpu_count // 2, 6))

        try:
            self._process_with_fallback(dataset_path, model, threshold, mode, batch_size, async_workers, images, total)
        except Exception as e:
            self._update_progress(error=str(e))
        finally:
            self._set_running(False)
            self._update_progress(current_file='', loading_model=False)
            self.tagger.unload_all()

    def _process_with_fallback(self, dataset_path, model, threshold, mode, batch_size, async_workers, images, total):
        try:
            self._process_batch(dataset_path, model, threshold, mode, batch_size, async_workers, images, total)
        except ValueError as e:
            if str(e) == "BATCH_SIZE_INCOMPATIBLE":
                self._process_batch(dataset_path, model, threshold, mode, 1, async_workers, images, total)
            else:
                raise

    def _process_batch(self, dataset_path, model, threshold, mode, batch_size, async_workers, images, total):
        from utils import get_caption_path, read_caption, write_caption, format_tags
        from utils import parse_tags

        with concurrent.futures.ThreadPoolExecutor(max_workers=async_workers) as executor:
            next_future = None
            for i in range(0, total, batch_size):
                if not self.is_running:
                    break
                batch_paths = images[i:i + batch_size]
                batch_paths_full = [os.path.join(dataset_path, p) for p in batch_paths]

                if next_future is not None:
                    try:
                        batch_tensors = next_future.result()
                    except Exception as e:
                        batch_tensors = [None] * len(batch_paths)
                else:
                    batch_tensors = self.tagger.preprocess_batch(batch_paths_full, model)

                next_i = i + batch_size
                if next_i < total:
                    next_batch_paths = images[next_i:next_i + batch_size]
                    next_batch_full = [os.path.join(dataset_path, p) for p in next_batch_paths]
                    next_future = executor.submit(self.tagger.preprocess_batch, next_batch_full, model)
                else:
                    next_future = None

                try:
                    batch_tags = self.tagger.tag_images_batch_from_tensors(batch_tensors, model, threshold, batch_size)
                except Exception as e:
                    error_msg = str(e)
                    if "invalid dimensions" in error_msg.lower() or "expected: 1" in error_msg.lower():
                        raise ValueError("BATCH_SIZE_INCOMPATIBLE")
                    elif "out of memory" in error_msg.lower() or "cuda" in error_msg.lower():
                        self._update_progress(
                            error="Выставлен слишком большой размер батча. СРОЧНО СМЕНИТЕ ЕГО ЗНАЧЕНИЕ В НАСТРОЙКАХ.")
                        return
                    else:
                        raise

                for idx, img in enumerate(batch_paths):
                    if batch_tags[idx] is None:
                        continue
                    txt_path = get_caption_path(os.path.join(dataset_path, img))
                    old_caption = read_caption(txt_path)
                    old_tags = parse_tags(old_caption) if old_caption else []

                    if mode == 'replace':
                        final_tags = batch_tags[idx]
                    elif mode == 'add_if_empty':
                        if not old_tags:
                            final_tags = batch_tags[idx]
                        else:
                            final_tags = old_tags
                    else:
                        existing_set = set(old_tags)
                        final_tags = old_tags + [tag for tag in batch_tags[idx] if tag not in existing_set]

                    write_caption(txt_path, format_tags(final_tags))

                    processed = self._progress.get('processed', 0) + 1
                    current = img if processed % 5 == 0 else self._progress.get('current_file', '')
                    self._update_progress(processed=processed, current_file=current)