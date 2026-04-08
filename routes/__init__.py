from .images import images_bp
from .analysis import analysis_bp
from .auto_tag import auto_tag_bp
from .rating import rating_bp
from .semantic import semantic_bp
from .crop import crop_bp
from .settings import settings_bp
from .vocabulary import vocabulary_bp
from .flags import flags_bp
from .backup import backup_bp

all_blueprints = [
    images_bp,
    analysis_bp,
    auto_tag_bp,
    rating_bp,
    semantic_bp,
    crop_bp,
    settings_bp,
    vocabulary_bp,
    flags_bp,
    backup_bp,
]