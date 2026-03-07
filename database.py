import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'dataset_editor.db')

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS translations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lang TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                UNIQUE(lang, key)
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS image_ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_path TEXT NOT NULL,
                filename TEXT NOT NULL,
                rating TEXT NOT NULL,
                UNIQUE(dataset_path, filename)
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS widget_layouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                layout TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS dataset_vocabulary (
                dataset_path TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()

def get_translation(lang, key):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT value FROM translations WHERE lang=? AND key=?', (lang, key))
        row = c.fetchone()
        return row[0] if row else key

def get_all_translations(lang):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT key, value FROM translations WHERE lang=?', (lang,))
        return dict(c.fetchall())

def get_nsfw_tags():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT tag FROM nsfw_tags')
        return [row[0] for row in c.fetchall()]

def add_nsfw_tag(tag):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('INSERT OR IGNORE INTO nsfw_tags (tag) VALUES (?)', (tag,))
        conn.commit()

def remove_nsfw_tag(tag):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('DELETE FROM nsfw_tags WHERE tag=?', (tag,))
        conn.commit()

def get_setting(key, default=None):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT value FROM settings WHERE key=?', (key,))
        row = c.fetchone()
        return row[0] if row else default

def set_setting(key, value):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('REPLACE INTO settings (key, value) VALUES (?,?)', (key, value))
        conn.commit()

def save_global_widget_layout(layout_json):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('DELETE FROM widget_layouts')
        c.execute('''
            INSERT INTO widget_layouts (layout, updated_at)
            VALUES (?, CURRENT_TIMESTAMP)
        ''', (layout_json,))
        conn.commit()

def get_global_widget_layout():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT layout FROM widget_layouts ORDER BY updated_at DESC LIMIT 1')
        row = c.fetchone()
        return row[0] if row else None

def save_image_rating(dataset_path, filename, rating):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('''
            INSERT OR REPLACE INTO image_ratings (dataset_path, filename, rating)
            VALUES (?, ?, ?)
        ''', (dataset_path, filename, rating))
        conn.commit()

def get_image_rating(dataset_path, filename):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT rating FROM image_ratings WHERE dataset_path=? AND filename=?', (dataset_path, filename))
        row = c.fetchone()
        return row[0] if row else None

def get_all_ratings_for_dataset(dataset_path):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT filename, rating FROM image_ratings WHERE dataset_path=?', (dataset_path,))
        return {row[0]: row[1] for row in c.fetchall()}

def clear_all_image_ratings():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('DELETE FROM image_ratings')
        c.execute('DELETE FROM dataset_vocabulary')
        conn.commit()

def save_dataset_vocabulary(dataset_path, content_json):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('''
            INSERT OR REPLACE INTO dataset_vocabulary (dataset_path, content, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        ''', (dataset_path, content_json))
        conn.commit()

def get_dataset_vocabulary(dataset_path):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT content FROM dataset_vocabulary WHERE dataset_path=?', (dataset_path,))
        row = c.fetchone()
        return row[0] if row else None