import os
import shutil
import threading
from .base import BaseManager
from utils import get_image_files, get_caption_path


class BackupManager(BaseManager):
    def __init__(self):
        super().__init__()
        self._progress = {'total': 0, 'processed': 0, 'current_file': '', 'error': None}

    def start(self, dataset_path: str):
        if self.is_running:
            return
        self._set_running(True)
        self._update_progress(total=0, processed=0, current_file='', error=None)

        thread = threading.Thread(target=self._run, args=(dataset_path,))
        thread.daemon = True
        thread.start()

    def _run(self, dataset_path: str):
        images = get_image_files(dataset_path)
        total = len(images)
        self._update_progress(total=total, processed=0, current_file='')

        backup_dir = os.path.join(dataset_path, 'backup')
        os.makedirs(backup_dir, exist_ok=True)

        try:
            for idx, img in enumerate(images):
                if not self.is_running:
                    break
                self._update_progress(current_file=img)
                src_img = os.path.join(dataset_path, img)
                dst_img = os.path.join(backup_dir, img)
                shutil.copy2(src_img, dst_img)
                txt_path = get_caption_path(src_img)
                if os.path.exists(txt_path):
                    dst_txt = os.path.join(backup_dir, os.path.basename(txt_path))
                    shutil.copy2(txt_path, dst_txt)
                self._update_progress(processed=idx + 1)
        except Exception as e:
            self._update_progress(error=str(e))
        finally:
            self._set_running(False)
            self._update_progress(current_file='')