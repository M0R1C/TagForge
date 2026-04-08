from managers import (
    AnalysisManager, AutoTagManager, RatingManager,
    BackupManager, CropManager, SemanticManager
)
import os
from database import Database
from auto_tag import AutoTagger

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class AppContext:
    def __init__(self):
        self.db = Database()
        self.tagger = AutoTagger(models_dir='models')
        self.current_dataset_path = None

        self.analysis = AnalysisManager(self.db)
        self.auto_tag = AutoTagManager(self.db, self.tagger)
        self.rating = RatingManager(self.db, self.tagger)
        self.backup = BackupManager()
        self.crop = CropManager()
        self.semantic = SemanticManager(self.db, self.tagger)
        self.active_host = None
        self.active_port = None

    def set_dataset_path(self, path):
        self.current_dataset_path = path