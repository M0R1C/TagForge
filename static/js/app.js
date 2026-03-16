let currentDatasetPath = '';
let currentDatasetName = '';
let currentImages = [];
let currentSettings = {};
let currentTags = [];
let selectedTags = [];
let currentImageIndex = 0;
let allTagsCounter = [];
let autoTaggingActive = false;
let autoStatusInterval = null;
let currentLanguage = 'ru';
let translations = {};
let backupActive = false;
let backupInterval = null;
let vocabOrder = [];
let zoomEnabled = true;
let zoomFactor = 2;
let pendingDeleteFilename = null;

let currentImagesRaw = [];
let filters = {
    ratings: [],
    minW: null,
    maxW: null,
    minH: null,
    maxH: null,
    aspects: [],
    multiple32: false,
    multiple64: false,
    multipleNot: false
};
let filterPanelVisible = false;
let filterDebounceTimer = null;

let analysisData = null;

let ratingActive = false;
let ratingInterval = null;

let vocabMode = false;
let vocabData = {};
let vocabEditMode = false;
let currentImageTags = [];

function t(key) {
    return translations[key] || key;
}


const datasetPathInput = document.getElementById('datasetPath');
const loadBtn = document.getElementById('loadDatasetBtn');
const imageCountSpan = document.getElementById('imageCount');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const tabButtons = document.querySelectorAll('.tab-button');
const mainContent = document.getElementById('mainContent');
const modal = document.getElementById('modal');
const modalImg = document.getElementById('modalImg');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const navInput = document.getElementById('navInput');
const totalCountSpan = document.getElementById('totalCount');
const infoBadges = document.getElementById('infoBadges');
const toggleVocabBtn = document.getElementById('toggleVocabBtn');

if (navInput) {
    navInput.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.deltaY < 0) {
            if (currentImageIndex < currentImages.length - 1) {
                currentImageIndex++;
                loadModalImage(currentImageIndex);
            }
        } else {
            if (currentImageIndex > 0) {
                currentImageIndex--;
                loadModalImage(currentImageIndex);
            }
        }
    });
}

let tagSearch, tagListDiv, imageGrid;

const deleteConfirmModal = document.getElementById('deleteConfirmModal');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
const dontAskCheckbox = document.getElementById('dontAskCheckbox');

function showDeleteConfirm(filename) {
    pendingDeleteFilename = filename;
    deleteConfirmModal.classList.add('show');
}

function hideDeleteConfirm() {
    deleteConfirmModal.classList.remove('show');
    pendingDeleteFilename = null;
    dontAskCheckbox.checked = false;
}

confirmDeleteBtn.addEventListener('click', () => {
    if (pendingDeleteFilename) {
        if (dontAskCheckbox.checked) {
            sessionStorage.setItem('dontAskDelete', 'true');
        }
        handleDeleteImage(pendingDeleteFilename);
        hideDeleteConfirm();
    }
});

cancelDeleteBtn.addEventListener('click', hideDeleteConfirm);

deleteConfirmModal.addEventListener('click', (e) => {
    if (e.target === deleteConfirmModal) hideDeleteConfirm();
});

function getColumnCount(containerWidth) {
    const minWidth = 180;
    const gap = 20;
    let columns = Math.floor((containerWidth + gap) / (minWidth + gap));
    return Math.max(1, columns);
}

function getItemPosition(index, columns, rowHeight, gap, containerWidth) {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const totalGapWidth = (columns - 1) * gap;
    const colWidth = (containerWidth - totalGapWidth) / columns;
    const left = col * (colWidth + gap);
    return {
        top: row * rowHeight,
        left: left + 'px',
        width: colWidth + 'px'
    };
}

async function loadTranslations(lang) {
    const resp = await fetch(`/api/translations/${lang}`);
    translations = await resp.json();
    applyTranslations();
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[key]) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.placeholder = translations[key];
            } else {
                el.textContent = translations[key];
            }
        }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (translations[key]) {
            el.placeholder = translations[key];
        }
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (translations[key]) {
            el.title = translations[key];
        }
    });
    if (translations.app_title) document.title = translations.app_title;
    document.querySelectorAll('.custom-select-container').forEach(container => container.remove());
    document.querySelectorAll('select.custom-select').forEach(select => select.removeAttribute('data-customized'));
    initCustomSelects();
}

function updateGradientVariables(accentColor) {
    const lightColor = adjustColor(accentColor, 40);
    document.documentElement.style.setProperty('--accent-gradient-start', accentColor);
    document.documentElement.style.setProperty('--accent-gradient-end', lightColor);
}

function startBackupPolling() {
    if (backupInterval) return;
    backupInterval = setInterval(async () => {
        const statusResp = await fetch('/api/backup/status');
        const status = await statusResp.json();
        updateBackupProgressUI(status);
        if (!status.running) {
            backupActive = false;
            stopBackupPolling();
            updateBackupButtonsUI();
        }
    }, 500);
}

async function handleDeleteImage(filename) {
    const success = await deleteImage(filename);
    if (success) {
        currentImagesRaw = currentImagesRaw.filter(img => img.filename !== filename);
        currentImages = currentImages.filter(img => img.filename !== filename);
        renderImageGrid(currentImages);
        document.getElementById('imageCount').textContent = currentImagesRaw.length;
        await refreshTagList();
        if (document.querySelector('.tab-button.active').dataset.tab === 'analysis') {
            refreshAnalysis();
        }
    }
}

async function deleteImage(filename) {
    const resp = await fetch('/api/delete-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
    });
    const data = await resp.json();
    if (data.error) {
        alert('Ошибка удаления: ' + data.error);
        return false;
    }
    return true;
}

function stopBackupPolling() {
    if (backupInterval) {
        clearInterval(backupInterval);
        backupInterval = null;
    }
}

function updateBackupProgressUI(status) {
    const container = document.getElementById('backupProgressContainer');
    const fill = document.getElementById('backupProgressFill');
    const current = document.getElementById('backupCurrentFile');
    if (!container) return;
    if (status.total > 0) {
        const percent = (status.processed / status.total) * 100;
        fill.style.width = percent + '%';
        current.textContent = status.current_file || t('idle');
    }
    container.style.display = status.running ? 'block' : 'none';
}

function updateBackupButtonsUI() {
    const backupBtn = document.getElementById('backupBtn');
    if (backupBtn) backupBtn.disabled = backupActive;
}

async function loadSettings() {
    const resp = await fetch('/api/settings');
    const settings = await resp.json();
    currentSettings = settings;
    currentLanguage = settings.language;
    zoomEnabled = settings.zoom_enabled !== undefined ? settings.zoom_enabled : true;
    zoomFactor = settings.zoom_factor !== undefined ? settings.zoom_factor : 2;
    document.documentElement.style.setProperty('--accent-color', settings.accent_color);
    const hoverColor = adjustColor(settings.accent_color, -20);
    document.documentElement.style.setProperty('--accent-hover', hoverColor);
    updateGradientVariables(settings.accent_color);
    await loadTranslations(currentLanguage);

    const wdInput = document.getElementById('workingDirectoryInput');
    if (wdInput && settings.working_directory !== undefined) {
        wdInput.value = settings.working_directory;
    }
}

function adjustColor(hex, percent) {
    let R = parseInt(hex.substring(1,3), 16);
    let G = parseInt(hex.substring(3,5), 16);
    let B = parseInt(hex.substring(5,7), 16);
    R = Math.min(255, Math.max(0, R + percent));
    G = Math.min(255, Math.max(0, G + percent));
    B = Math.min(255, Math.max(0, B + percent));
    return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
}

function startAutoStatusPolling() {
    if (autoStatusInterval) return;
    autoStatusInterval = setInterval(async () => {
        const statusResp = await fetch('/api/auto-tag/status');
        const status = await statusResp.json();
        updateAutoProgressUI(status);
        if (!status.running) {
            autoTaggingActive = false;
            stopAutoStatusPolling();
            updateAutoButtonsUI();
        }
    }, 500);
}

function stopAutoStatusPolling() {
    if (autoStatusInterval) {
        clearInterval(autoStatusInterval);
        autoStatusInterval = null;
    }
}

function updateAutoProgressUI(status) {
    const progressContainer = document.getElementById('progressContainer');
    const progressFill = document.getElementById('progressFill');
    const currentFileEl = document.getElementById('currentFile');
    if (!progressContainer) return;
    if (status.total > 0) {
        const percent = (status.processed / status.total) * 100;
        progressFill.style.width = percent + '%';
        currentFileEl.textContent = status.current_file || t('idle');
    }
    progressContainer.style.display = status.running ? 'block' : 'none';
}

function updateAutoButtonsUI() {
    const startBtn = document.getElementById('startAutoBtn');
    const stopBtn = document.getElementById('stopAutoBtn');
    if (!startBtn || !stopBtn) return;
    startBtn.disabled = autoTaggingActive;
    stopBtn.disabled = !autoTaggingActive;
}

function startRatingPolling() {
    if (ratingInterval) return;
    ratingInterval = setInterval(async () => {
        const resp = await fetch('/api/rating-analysis/status');
        const status = await resp.json();
        updateRatingProgress(status);
        if (!status.running) {
            stopRatingPolling();
            showRatingComplete();
        }
    }, 500);
}

function stopRatingPolling() {
    if (ratingInterval) {
        clearInterval(ratingInterval);
        ratingInterval = null;
    }
}

function updateRatingProgress(status) {
    const container = document.getElementById('ratingProgressContainer');
    if (!container) return;
    if (status.running && status.total > 0) {
        container.style.display = 'flex';
        const fill = document.getElementById('ratingProgressFill');
        const current = document.getElementById('ratingCurrentFile');
        const percent = (status.processed / status.total) * 100;
        fill.style.width = percent + '%';
        current.textContent = status.current_file || '';
    }
}

function showRatingComplete() {
    const container = document.getElementById('ratingProgressContainer');
    if (!container) return;
    container.style.padding = '0';
    container.style.justifyContent = 'center';
    container.style.backgroundColor = 'transparent';
    container.style.border = 'none';
    container.innerHTML = '<span class="rating-complete">✓</span>';

    setTimeout(() => {
        container.style.display = 'none';
        container.innerHTML = `
            <div class="rating-progress-bar">
                <div id="ratingProgressFill" style="width:0%"></div>
            </div>
            <span id="ratingCurrentFile" class="rating-current-file"></span>
        `;
        container.style.padding = '';
        container.style.justifyContent = '';
        container.style.backgroundColor = '';
        container.style.border = '';
    }, 2000);
}

sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    sidebarToggle.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
});

function animateContent() {
    mainContent.classList.remove('content-fade-in');
    void mainContent.offsetWidth;
    mainContent.classList.add('content-fade-in');
}

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tabName = btn.dataset.tab;
        renderTab(tabName);
    });
});

function renderTab(tabName) {
    if (tabName === 'mass') {
        mainContent.innerHTML = getMassHTML();
        attachMassHandlers();
        loadModels();
        attachAutoHandlersToMass();
        initCustomSelects();

        if (autoTaggingActive) {
            startAutoStatusPolling();
            fetch('/api/auto-tag/status')
                .then(res => res.json())
                .then(status => updateAutoProgressUI(status));
        } else {
            stopAutoStatusPolling();
            const prog = document.getElementById('progressContainer');
            if (prog) prog.style.display = 'none';
        }
    } else if (tabName === 'point') {
        mainContent.innerHTML = getPointHTML();
        tagSearch = document.getElementById('tagSearch');
        tagListDiv = document.getElementById('tagList');
        imageGrid = document.getElementById('imageGrid');
        if (tagSearch) {
            tagSearch.addEventListener('input', () => {
                renderTagList(allTagsCounter);
            });
        }
        if (currentDatasetPath) {
            loadTagsAndImages();
        } else {
            if (imageGrid) imageGrid.innerHTML = `<p style="color: #888; text-align: center;">${t('no_dataset')}</p>`;
        }
        stopAutoStatusPolling();
        attachFilterHandlers();
    } else if (tabName === 'datasets') {
        mainContent.innerHTML = `<div id="datasetsContainer"></div>`;
        if (window.DatasetsTab) {
            window.DatasetsTab.init(document.getElementById('datasetsContainer'));
        } else {
            mainContent.innerHTML = `<p>Загрузка модуля датасетов...</p>`;
        }
    } else if (tabName === 'analysis') {
        mainContent.innerHTML = getAnalysisHTML();
        initAnalysisTab();
        stopAutoStatusPolling();
    } else if (tabName === 'settings') {
        mainContent.innerHTML = getSettingsHTML();
        initCustomSelects();
        attachSettingsHandlers();
        populateLanguages();

        const colorPicker = document.getElementById('accentColorPicker');
        if (colorPicker) {
            const currentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
            colorPicker.value = currentColor || '#3b82f6';
        }
        stopAutoStatusPolling();
    }
    applyTranslations();
    animateContent();
}

function getMassHTML() {
    return `
        <div style="display: flex; flex-wrap: wrap; gap: 20px;">
            <!-- Карточка массовых операций -->
            <div class="mass-panel" style="flex: 1 1 400px;">
                <h3 data-i18n="mass_edit_title">Массовое редактирование</h3>
                <div class="mass-row">
                    <span class="mass-label" data-i18n="rename_description">Пронумеровать файлы по порядку</span>
                    <button id="bulkRenameBtn" class="btn-primary" data-i18n="bulk_rename">Переименовать все файлы (1,2,3...)</button>
                </div>
                <div class="mass-row">
                    <input type="text" id="deleteTagsInput" class="mass-input" data-i18n-placeholder="tags_placeholder">
                    <button id="bulkDeleteBtn" class="btn-primary" data-i18n="bulk_delete">Удалить</button>
                </div>
                <div class="mass-row">
                    <input type="text" id="addTagsInput" class="mass-input" data-i18n-placeholder="tags_placeholder">
                    <div class="radio-group">
                        <label class="custom-radio">
                            <input type="radio" name="addPosition" value="start" checked>
                            <span class="radiomark"></span>
                            <span data-i18n="add_to_start">В начало</span>
                        </label>
                        <label class="custom-radio">
                            <input type="radio" name="addPosition" value="end">
                            <span class="radiomark"></span>
                            <span data-i18n="add_to_end">В конец</span>
                        </label>
                    </div>
                    <button id="bulkAddBtn" class="btn-primary" data-i18n="bulk_add">Добавить</button>
                </div>
                <div class="mass-row replace-row">
                    <input type="text" id="replaceOldInput" class="mass-input" data-i18n-placeholder="replace_old_placeholder">
                    <input type="text" id="replaceNewInput" class="mass-input" data-i18n-placeholder="replace_new_placeholder">
                    <button id="bulkReplaceBtn" class="btn-primary" data-i18n="bulk_replace">Заменить</button>
                </div>
                <div class="mass-row">
                    <span class="mass-label" data-i18n="backup_label">Резервное копирование</span>
                    <button id="backupBtn" class="btn-primary" data-i18n="backup_dataset">Создать бэкап</button>
                </div>
                <div id="backupProgressContainer" style="margin-top:20px; display:none;">
                    <div class="progress-bar"><div id="backupProgressFill" style="width:0%"></div></div>
                    <p id="backupCurrentFile"></p>
                </div>
            </div>

            <!-- Карточка автотеггинга -->
            <div class="mass-panel" style="flex: 1 1 400px;">
                <h3 data-i18n="auto_tagging">Автоматическое тегирование</h3>
                <div class="form-group">
                    <label data-i18n="model">Модель</label>
                    <select id="modelSelect" class="custom-select"></select>
                </div>
                <div class="form-group">
                    <label>
                        <span data-i18n="threshold">Порог уверенности:</span>
                        <span id="thresholdValue">0.35</span>
                    </label>
                    <input type="range" id="thresholdSlider" min="0" max="1" step="0.01" value="0.35">
                </div>
                <div class="form-group">
                    <label data-i18n="mode">Режим</label>
                    <select id="modeSelect" class="custom-select">
                        <option value="append" data-i18n="append_mode">Добавить к существующим</option>
                        <option value="replace" data-i18n="replace_mode">Заменить все теги</option>
                        <option value="add_if_empty" data-i18n="add_if_empty_mode">Только для изображений без тегов</option>
                    </select>
                </div>
                <div class="button-group">
                    <button id="startAutoBtn" class="btn-primary" data-i18n="start">Запустить</button>
                    <button id="stopAutoBtn" class="btn-secondary" disabled data-i18n="stop">Остановить</button>
                </div>

                <div id="progressContainer" style="margin-top:20px; display:none;">
                    <div class="progress-bar"><div id="progressFill" style="width:0%"></div></div>
                    <p id="currentFile"></p>
                </div>
            </div>
        </div>
    `;
}

function getPointHTML() {
    return `
        <div class="point-layout">
            <div class="image-grid-container">
                <div id="imageGrid" class="image-grid"></div>
            </div>
            <div class="tag-list-container">
                <!-- Кнопка раскрытия фильтров -->
                <div class="filter-toggle">
                    <button id="filterToggleBtn" class="filter-toggle-btn">
                        <span data-i18n="filters">Фильтры</span>
                        <span class="arrow">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </span>
                    </button>
                </div>
                <!-- Панель фильтров (изначально скрыта) -->
                <div id="filterPanel" class="filter-panel">
                    <!-- Возрастной рейтинг (чекбоксы) -->
                    <div class="filter-section">
                        <h4 data-i18n="rating">Возрастной рейтинг</h4>
                        <label class="custom-checkbox">
                            <input type="checkbox" value="general" class="filter-rating">
                            <span class="checkmark"></span>
                            PG
                        </label>
                        <label class="custom-checkbox">
                            <input type="checkbox" value="sensitive" class="filter-rating">
                            <span class="checkmark"></span>
                            PG-13
                        </label>
                        <label class="custom-checkbox">
                            <input type="checkbox" value="questionable" class="filter-rating">
                            <span class="checkmark"></span>
                            R
                        </label>
                        <label class="custom-checkbox">
                            <input type="checkbox" value="explicit" class="filter-rating">
                            <span class="checkmark"></span>
                            XXX
                        </label>
                    </div>

                    <!-- Разрешение -->
                    <div class="filter-section">
                        <h4 data-i18n="resolution">Разрешение</h4>
                        <div class="filter-row">
                            <input type="number" id="filterMinW" class="filter-input" placeholder="W min" value="">
                            <span class="filter-separator">—</span>
                            <input type="number" id="filterMaxW" class="filter-input" placeholder="W max" value="">
                        </div>
                        <div class="filter-row">
                            <input type="number" id="filterMinH" class="filter-input" placeholder="H min" value="">
                            <span class="filter-separator">—</span>
                            <input type="number" id="filterMaxH" class="filter-input" placeholder="H max" value="">
                        </div>
                    </div>

                    <!-- Соотношение сторон (кнопки) -->
                    <div class="filter-section">
                        <h4 data-i18n="aspect_ratio">Соотношение сторон</h4>
                        <div class="aspect-buttons" id="aspectButtons">
                            <button type="button" class="aspect-btn" data-aspect="1:1">1:1</button>
                            <button type="button" class="aspect-btn" data-aspect="4:3">4:3</button>
                            <button type="button" class="aspect-btn" data-aspect="3:4">3:4</button>
                            <button type="button" class="aspect-btn" data-aspect="16:9">16:9</button>
                            <button type="button" class="aspect-btn" data-aspect="9:16">9:16</button>
                            <button type="button" class="aspect-btn" data-aspect="2:3">2:3</button>
                            <button type="button" class="aspect-btn" data-aspect="3:2">3:2</button>
                            <button type="button" class="aspect-btn" data-aspect="21:9">21:9</button>
                            <button type="button" class="aspect-btn" data-aspect="9:21">9:21</button>
                        </div>
                    </div>

                    <!-- Кратность (чекбоксы) -->
                    <div class="filter-section">
                        <h4 data-i18n="multiplicity">Кратность</h4>
                        <div class="multiplicity-group">
                            <label class="custom-checkbox">
                                <input type="checkbox" class="filter-multiple" value="32">
                                <span class="checkmark"></span>
                                <span data-i18n="multiple_32">Кратно 32</span>
                            </label>
                            <label class="custom-checkbox">
                                <input type="checkbox" class="filter-multiple" value="64">
                                <span class="checkmark"></span>
                                <span data-i18n="multiple_64">Кратно 64</span>
                            </label>
                            <label class="custom-checkbox">
                                <input type="checkbox" class="filter-multiple" value="not">
                                <span class="checkmark"></span>
                                <span data-i18n="multiple_not">Не кратно 32/64</span>
                            </label>
                        </div>
                    </div>

                    <!-- Кнопка сброса -->
                    <div class="filter-actions">
                        <button id="resetFiltersBtn" class="btn-secondary" data-i18n="reset">Сбросить</button>
                    </div>
                </div>

                <!-- Поиск по тегам -->
                <input type="text" id="tagSearch" data-i18n-placeholder="search_tags">
                <div id="tagList" class="tag-list"></div>
            </div>
        </div>
    `;
}

function getAnalysisHTML() {
    return `
        <div class="analysis-panel" style="position: relative; min-height: 500px;">
            <div class="widget-grid" id="widgetGrid"></div>
            <button class="btn-add-widget-floating" id="addWidgetBtn" title="Добавить виджет">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                    <path d="M12 5v14M5 12h14"/>
                </svg>
            </button>
        </div>
    `;
}

function getSettingsHTML() {
    return `
        <div class="settings-panel">
            <h3 data-i18n="language">Язык</h3>
            <select id="languageSelect" class="custom-select"></select>

            <h3 data-i18n="accent_color">Акцентный цвет</h3>
            <input type="color" id="accentColorPicker" value="#3b82f6">

            <h3 data-i18n="working_directory">Рабочая директория</h3>
            <input type="text" id="workingDirectoryInput" placeholder="/path/to/workspace" value="">

            <h3 data-i18n="zoom_settings">Настройки лупы</h3>
            <div class="form-group">
                <label class="custom-checkbox">
                    <input type="checkbox" id="zoomEnabledCheckbox" checked>
                    <span class="checkmark"></span>
                    <span data-i18n="zoom_enabled">Включить лупу в редакторе</span>
                </label>
            </div>
            <div class="form-group">
                <label data-i18n="zoom_factor">Коэффициент увеличения:</label>
                <input type="number" id="zoomFactorInput" min="1" max="5" step="0.5" value="2">
            </div>

            <!-- Разделитель перед опасной кнопкой -->
            <hr style="margin: 24px 0; border: 1px solid var(--border-color);">

            <h3 data-i18n="reset_ratings_title">Сброс возрастных рейтингов</h3>
            <p data-i18n="reset_ratings_description" style="color: var(--text-secondary); font-size: 14px; margin-bottom: 16px;">
                Сброс хранящихся данных об оценках рейтингов фотографий в датасетах. Используйте, если вашей обновлённой фотографии в датасете присвоен неверный возрастной рейтинг или если просто хотите почистить базу, уменьшив её объём. Новая оценка будет автоматически присвоена после загрузки датасета.
            </p>
            <button id="resetRatingsBtn" class="btn-primary" data-i18n="reset_ratings_button">Очистить рейтинги и перезагрузить</button>
        </div>
    `;
}


loadBtn.addEventListener('click', async () => {
    const path = datasetPathInput.value.trim();
    if (!path) return;
    const response = await fetch('/api/load-dataset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
    });
    const data = await response.json();
    if (data.error) {
        alert(data.error);
        return;
    }
    currentDatasetPath = path;
    currentDatasetName = path.split(/[\\/]/).pop();
    imageCountSpan.textContent = data.count;
    startRatingPolling();

    const activeTab = document.querySelector('.tab-button.active').dataset.tab;
    if (activeTab === 'point') {
        renderTab('point');
    } else if (activeTab === 'analysis') {
        renderTab('analysis');
    }
});

async function refreshTagList() {
    if (!currentDatasetPath) return;
    const tagsResp = await fetch('/api/get-tags');
    const tags = await tagsResp.json();
    allTagsCounter = tags;
    if (tagListDiv) {
        renderTagList(tags);
    }
}


async function loadTagsAndImages() {
    const tagsResp = await fetch('/api/get-tags');
    const tags = await tagsResp.json();
    allTagsCounter = tags;
    renderTagList(tags);
    await loadImages();
    await refreshTagList();
}

function attachFilterHandlers() {
    const toggleBtn = document.getElementById('filterToggleBtn');
    const filterPanel = document.getElementById('filterPanel');
    if (!toggleBtn || !filterPanel) return;

    toggleBtn.addEventListener('click', () => {
        filterPanelVisible = !filterPanelVisible;
        if (filterPanelVisible) {
            filterPanel.classList.add('visible');
            toggleBtn.classList.add('active');
        } else {
            filterPanel.classList.remove('visible');
            toggleBtn.classList.remove('active');
        }
    });

    const ratingCheckboxes = document.querySelectorAll('.filter-rating');
    const minW = document.getElementById('filterMinW');
    const maxW = document.getElementById('filterMaxW');
    const minH = document.getElementById('filterMinH');
    const maxH = document.getElementById('filterMaxH');
    const aspectButtons = document.querySelectorAll('.aspect-btn');
    const multipleCheckboxes = document.querySelectorAll('.filter-multiple');
    const resetBtn = document.getElementById('resetFiltersBtn');

    function collectAndApply() {
        filters.ratings = Array.from(ratingCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value);

        filters.minW = minW.value ? parseInt(minW.value, 10) : null;
        filters.maxW = maxW.value ? parseInt(maxW.value, 10) : null;
        filters.minH = minH.value ? parseInt(minH.value, 10) : null;
        filters.maxH = maxH.value ? parseInt(maxH.value, 10) : null;

        filters.aspects = Array.from(aspectButtons)
            .filter(btn => btn.classList.contains('selected'))
            .map(btn => btn.dataset.aspect);

        const mult32 = Array.from(multipleCheckboxes).find(cb => cb.value === '32' && cb.checked);
        const mult64 = Array.from(multipleCheckboxes).find(cb => cb.value === '64' && cb.checked);
        const multNot = Array.from(multipleCheckboxes).find(cb => cb.value === 'not' && cb.checked);

        filters.multiple32 = !!mult32;
        filters.multiple64 = !!mult64;
        filters.multipleNot = !!multNot;

        applyFilters();
    }

    function debounceCollect() {
        clearTimeout(filterDebounceTimer);
        filterDebounceTimer = setTimeout(collectAndApply, 300);
    }

    ratingCheckboxes.forEach(cb => cb.addEventListener('change', collectAndApply));
    minW.addEventListener('input', debounceCollect);
    maxW.addEventListener('input', debounceCollect);
    minH.addEventListener('input', debounceCollect);
    maxH.addEventListener('input', debounceCollect);

    aspectButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('selected');
            collectAndApply();
        });
    });

    multipleCheckboxes.forEach(cb => {
        cb.addEventListener('change', collectAndApply);
    });

    resetBtn.addEventListener('click', () => {
        ratingCheckboxes.forEach(cb => cb.checked = false);

        minW.value = '';
        maxW.value = '';
        minH.value = '';
        maxH.value = '';

        aspectButtons.forEach(btn => btn.classList.remove('selected'));
        multipleCheckboxes.forEach(cb => cb.checked = false);

        filters = {
            ratings: [],
            minW: null,
            maxW: null,
            minH: null,
            maxH: null,
            aspects: [],
            multiple32: false,
            multiple64: false,
            multipleNot: false
        };

        applyFilters();
    });
}

function resetFiltersAndReload() {
    if (document.querySelector('.tab-button.active').dataset.tab === 'point') {
        const resetBtn = document.getElementById('resetFiltersBtn');
        if (resetBtn) resetBtn.click();
        else {
            loadTagsAndImages();
        }
    }
}

async function loadImages() {
    const resp = await fetch('/api/get-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: selectedTags })
    });
    const images = await resp.json();
    currentImagesRaw = images;
    applyFilters();
}

function applyFilters() {
    if (!currentImagesRaw.length) {
        currentImages = [];
        renderImageGrid(currentImages);
        return;
    }

    const filtered = currentImagesRaw.filter(img => {
        if (filters.ratings.length > 0 && !filters.ratings.includes(img.rating)) {
            return false;
        }

        if (filters.minW !== null && img.width < filters.minW) return false;
        if (filters.maxW !== null && img.width > filters.maxW) return false;
        if (filters.minH !== null && img.height < filters.minH) return false;
        if (filters.maxH !== null && img.height > filters.maxH) return false;

        if (filters.aspects.length > 0) {
            const aspect = getAspectLabel(img.width / img.height);
            if (!filters.aspects.includes(aspect)) return false;
        }

        const multiple32 = (img.width % 32 === 0 && img.height % 32 === 0);
        const multiple64 = (img.width % 64 === 0 && img.height % 64 === 0);

        if (filters.multipleNot) {
            if (multiple32 || multiple64) return false;
        } else {
            if (filters.multiple32 && !multiple32) return false;
            if (filters.multiple64 && !multiple64) return false;
        }

        return true;
    });

    currentImages = filtered;
    renderImageGrid(currentImages);
}

function getAspectLabel(ratio) {
    const targets = {
        '1:1': 1.0,
        '4:3': 4/3,
        '3:4': 3/4,
        '16:9': 16/9,
        '9:16': 9/16,
        '2:3': 2/3,
        '3:2': 3/2,
        '21:9': 21/9,
        '9:21': 9/21,
    };
    let best = '?';
    let minDiff = Infinity;
    for (let [key, val] of Object.entries(targets)) {
        const diff = Math.abs(ratio - val);
        if (diff < minDiff) {
            minDiff = diff;
            best = key;
        }
    }
    return best;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderTagList(tags) {
    if (!tagListDiv) return;
    tagListDiv.innerHTML = '';
    const searchTerm = tagSearch ? tagSearch.value.toLowerCase() : '';
    const filtered = searchTerm
        ? tags.filter(t => t.tag.toLowerCase().includes(searchTerm))
        : tags;

    filtered.forEach(t => {
        const div = document.createElement('div');
        div.className = `tag-item ${selectedTags.includes(t.tag) ? 'selected' : ''}`;
        div.innerHTML = `<span>${t.tag}</span><span class="tag-count">${t.count}</span>`;
        div.addEventListener('click', () => {
            const index = selectedTags.indexOf(t.tag);
            if (index === -1) {
                selectedTags.push(t.tag);
            } else {
                selectedTags.splice(index, 1);
            }
            renderTagList(tags);
            loadImages();
        });
        tagListDiv.appendChild(div);
    });
}

function renderImageGrid(images) {
    const container = document.getElementById('imageGrid');
    if (!container) return;

    if (container._virtualScrollCleanup) {
        container._virtualScrollCleanup();
    }
    if (container._clickHandler) {
        container.removeEventListener('click', container._clickHandler);
        container._clickHandler = null;
    }

    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.height = '1px';

    if (images.length === 0) {
        container.innerHTML = '<p style="color: #888; text-align: center;">' + t('no_images') + '</p>';
        return;
    }

    const CARD_HEIGHT = 210;
    const GAP = 20;
    const ROW_HEIGHT = CARD_HEIGHT + GAP;
    const BUFFER = 5;

    let visibleItems = new Map();
    let currentRange = { start: 0, end: 0 };
    let lastContainerWidth = container.clientWidth;

    const scrollContainer = document.querySelector('.image-grid-container');
    if (!scrollContainer) {
        console.error('Не найден контейнер прокрутки .image-grid-container');
        return;
    }

    function updateVisibleRange() {
        if (!scrollContainer) return;

        const scrollTop = scrollContainer.scrollTop;
        const viewportHeight = scrollContainer.clientHeight;
        const containerWidth = container.clientWidth;

        if (containerWidth !== lastContainerWidth) {
            visibleItems.forEach(el => el.remove());
            visibleItems.clear();
            currentRange.start = 0;
            currentRange.end = 0;
            lastContainerWidth = containerWidth;
        }

        const columns = getColumnCount(containerWidth);
        const totalRows = Math.ceil(images.length / columns);
        const totalHeight = totalRows * ROW_HEIGHT;
        container.style.height = totalHeight + 'px';

        const firstVisibleRow = Math.floor(scrollTop / ROW_HEIGHT);
        const lastVisibleRow = Math.floor((scrollTop + viewportHeight) / ROW_HEIGHT);

        const startRow = Math.max(0, firstVisibleRow - BUFFER);
        const endRow = Math.min(totalRows - 1, lastVisibleRow + BUFFER);

        const newStart = startRow * columns;
        const newEnd = Math.min(images.length - 1, (endRow + 1) * columns - 1);

        if (newStart === currentRange.start && newEnd === currentRange.end && visibleItems.size > 0) return;

        currentRange.start = newStart;
        currentRange.end = newEnd;

        for (let [index, el] of visibleItems.entries()) {
            if (index < newStart || index > newEnd) {
                el.remove();
                visibleItems.delete(index);
            }
        }

        for (let i = newStart; i <= newEnd; i++) {
            if (visibleItems.has(i)) continue;
            const img = images[i];
            const div = createCardElement(img, i, columns, ROW_HEIGHT, GAP, containerWidth);
            container.appendChild(div);
            visibleItems.set(i, div);
        }
    }

    function createCardElement(img, index, columns, rowHeight, gap, containerWidth) {
        const div = document.createElement('div');
        div.className = 'image-card';
        div.dataset.filename = img.filename;
        div.dataset.index = index;

        const pos = getItemPosition(index, columns, rowHeight, gap, containerWidth);
        div.style.position = 'absolute';
        div.style.top = pos.top + 'px';
        div.style.left = pos.left;
        div.style.width = pos.width;
        div.style.height = CARD_HEIGHT + 'px';

        const v = img.mtime ? img.mtime : Date.now();
        const thumbSrc = `/api/thumbnail/${encodeURIComponent(img.filename)}?v=${v}`;

        const imgElement = document.createElement('img');
        imgElement.src = thumbSrc;
        imgElement.alt = img.filename;
        imgElement.loading = 'lazy';
        imgElement.decoding = 'async';
        imgElement.classList.add('image-card-img');

        const infoDiv = document.createElement('div');
        infoDiv.className = 'image-info';
        infoDiv.innerHTML = `<span class="image-filename">${escapeHtml(img.filename)}</span><span class="image-tag-count">${t('tags_label')}: ${img.tag_count}</span>`;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-image-btn';
        deleteBtn.dataset.filename = img.filename;
        deleteBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
        `;

        div.appendChild(imgElement);
        div.appendChild(infoDiv);
        div.appendChild(deleteBtn);

        return div;
    }

    const onScroll = () => requestAnimationFrame(updateVisibleRange);
    scrollContainer.addEventListener('scroll', onScroll);

    const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(updateVisibleRange);
    });
    resizeObserver.observe(container);

    window.addEventListener('resize', onScroll);

    const clickHandler = (e) => {
        const card = e.target.closest('.image-card');
        if (!card) return;

        const filename = card.dataset.filename;

        if (e.target.closest('.delete-image-btn')) {
            e.stopPropagation();
            if (sessionStorage.getItem('dontAskDelete') === 'true') {
                handleDeleteImage(filename);
            } else {
                showDeleteConfirm(filename);
            }
            return;
        }

        const index = parseInt(card.dataset.index, 10);
        if (!isNaN(index)) {
            openModal(index);
        }
    };
    container.addEventListener('click', clickHandler);
    container._clickHandler = clickHandler;

    container._virtualScrollCleanup = () => {
        scrollContainer.removeEventListener('scroll', onScroll);
        resizeObserver.disconnect();
        window.removeEventListener('resize', onScroll);
        if (container._clickHandler) {
            container.removeEventListener('click', container._clickHandler);
            container._clickHandler = null;
        }
    };

    updateVisibleRange();
}

async function openModal(index) {
    if (!currentImages.length || index < 0 || index >= currentImages.length) return;
    currentImageIndex = index;
    await loadModalImage(currentImageIndex);
    modal.classList.add('show');
    document.addEventListener('keydown', modalKeyHandler);
}

function closeModal() {
    modal.classList.remove('show');
    document.removeEventListener('keydown', modalKeyHandler);
    vocabMode = false;
    vocabEditMode = false;
    infoBadges.style.display = '';
}

function modalKeyHandler(e) {
    if (e.key === 'Escape') closeModal();
}

modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
});

async function loadModalImage(index) {
    const img = currentImages[index];
    if (!img) return;

    modalImg.src = `/api/image/${encodeURIComponent(img.filename)}?t=${Date.now()}`;
    modalImg.onload = setupZoom;

    const captionResp = await fetch('/api/get-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: img.filename })
    });
    const captionData = await captionResp.json();
    currentImageTags = parseTags(captionData.caption);
    document.getElementById('modalFilename').textContent = img.filename;

    await updateInfoBadges(img);

    navInput.value = index + 1;
    totalCountSpan.textContent = `/ ${currentImages.length}`;
    navInput.max = currentImages.length;

    await loadVocabulary();

    renderModalContent();
}

function parseTags(caption) {
    if (!caption) return [];
    return caption.split(',').map(t => t.trim()).filter(t => t);
}

async function updateInfoBadges(img) {
    let rating = 'general';
    try {
        const resp = await fetch(`/api/image-rating/${encodeURIComponent(img.filename)}`);
        const data = await resp.json();
        rating = data.rating;
    } catch (e) {
        console.error('Ошибка получения рейтинга:', e);
    }

    let ratingBadgeClass = 'green';
    let ratingText = 'PG';
    if (rating === 'general') {
        ratingText = 'PG';
        ratingBadgeClass = 'green';
    } else if (rating === 'sensitive') {
        ratingText = 'PG-13';
        ratingBadgeClass = 'green';
    } else if (rating === 'questionable') {
        ratingText = 'R';
        ratingBadgeClass = 'red';
    } else if (rating === 'explicit') {
        ratingText = 'XXX';
        ratingBadgeClass = 'red';
    }

    const width = img.width || 0;
    const height = img.height || 0;
    const resolution = `${width}x${height}`;

    let aspect = '?';
    if (width && height) {
        const ratio = width / height;
        const aspects = {
            '1:1': 1.0,
            '4:3': 4 / 3,
            '3:4': 3 / 4,
            '16:9': 16 / 9,
            '9:16': 9 / 16,
            '2:3': 2 / 3,
            '3:2': 3 / 2,
            '21:9': 21 / 9,
            '9:21': 9 / 21,
        };
        let best = '?';
        let minDiff = Infinity;
        for (let [key, val] of Object.entries(aspects)) {
            const diff = Math.abs(ratio - val);
            if (diff < minDiff) {
                minDiff = diff;
                best = key;
            }
        }
        aspect = best;
    }

    const mult32 = (width % 32 === 0 && height % 32 === 0);
    const mult64 = (width % 64 === 0 && height % 64 === 0);

    let badgesHtml = `
        <span class="badge ${ratingBadgeClass}">${ratingText}</span>
        <span class="badge">${resolution}</span>
        <span class="badge">${aspect}</span>
        <span class="badge ${mult32 ? 'green' : 'red'}">${mult32 ? t('multiple_32') : t('not_multiple_32')}</span>
    `;
    if (mult64) {
        badgesHtml += `<span class="badge green">${t('multiple_64')}</span>`;
    }
    infoBadges.innerHTML = badgesHtml;
}

function updateImageCard(filename, newTagCount) {
    const card = document.querySelector(`.image-card[data-filename="${filename}"]`);
    if (card) {
        const tagCountSpan = card.querySelector('.image-tag-count');
        if (tagCountSpan) {
            tagCountSpan.textContent = newTagCount;
        }
    }
}

async function loadVocabulary() {
    if (!currentDatasetPath) return;
    const resp = await fetch(`/api/vocabulary/${encodeURIComponent(currentDatasetPath)}`);
    const data = await resp.json();
    vocabData = data.content || {};
    vocabOrder = data.content ? Object.keys(data.content) : ["Trigger_words", "Default outfit", "Optional"];
}

function renderModalContent() {
    const dynamicDiv = document.getElementById('modalDynamicContent');
    if (!dynamicDiv) return;

    if (vocabMode) {
        infoBadges.style.display = 'none';
    } else {
        infoBadges.style.display = '';
    }
    dynamicDiv.innerHTML = '';

    if (vocabMode) {
        if (vocabEditMode) {
            renderVocabEdit(dynamicDiv);
        } else {
            renderVocabView(dynamicDiv);
        }
    } else {
        renderCaptionEdit(dynamicDiv);
    }
}

function renderCaptionEdit(container) {
    container.innerHTML = `
        <textarea id="captionText" placeholder="${t('caption_placeholder')}">${currentImageTags.join(', ')}</textarea>
        <div class="suggestions" id="suggestions"></div>
    `;
    const textarea = document.getElementById('captionText');
    textarea.addEventListener('input', onCaptionInput);
    showSuggestions(textarea.value);
}

let saveTimeout;
function onCaptionInput(e) {
    const textarea = e.target;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        const img = currentImages[currentImageIndex];
        if (!img) return;

        const newCaption = textarea.value;
        currentImageTags = parseTags(newCaption);

        try {
            await fetch('/api/update-caption', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: img.filename, caption: newCaption })
            });
            await updateInfoBadges(img);
            showSuggestions(newCaption);
            await refreshTagList();
            const imgObj = currentImagesRaw.find(i => i.filename === img.filename);
            if (imgObj) {
                imgObj.tag_count = currentImageTags.length;
            }
            updateImageCard(img.filename, currentImageTags.length);
        } catch (err) {
            console.error('Error saving caption:', err);
        }
    }, 500);
    showSuggestions(textarea.value);
}

function showSuggestions(currentText) {
    const suggestionsDiv = document.getElementById('suggestions');
    if (!suggestionsDiv) return;
    const parts = currentText.split(',');
    const lastPart = parts.pop().trim();
    if (!lastPart || lastPart.length < 2) {
        suggestionsDiv.innerHTML = '';
        return;
    }
    const matches = allTagsCounter
        .filter(t => t.tag.toLowerCase().startsWith(lastPart.toLowerCase()) && t.tag.toLowerCase() !== lastPart.toLowerCase())
        .slice(0, 3);
    suggestionsDiv.innerHTML = '';
    matches.forEach(m => {
        const span = document.createElement('span');
        span.className = 'suggestion-tag';
        span.textContent = m.tag;
        span.addEventListener('click', () => {
            const newParts = [...parts, m.tag];
            const newText = newParts.map(p => p.trim()).join(', ');
            document.getElementById('captionText').value = newText;
            document.getElementById('captionText').dispatchEvent(new Event('input'));
            suggestionsDiv.innerHTML = '';
            document.getElementById('captionText').focus();
        });
        suggestionsDiv.appendChild(span);
    });
}

function renderVocabView(container) {
    container.innerHTML = `
        <div style="display: flex; justify-content: flex-end; margin-bottom: 16px;">
            <button id="editVocabBtn" class="btn-icon" title="${t('edit_vocab')}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                </svg>
            </button>
        </div>
        <div id="vocabSections"></div>
    `;

    const sectionsDiv = document.getElementById('vocabSections');
    for (let section of vocabOrder) {
        const tags = vocabData[section] || [];
        if (tags.length === 0) continue;
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'vocab-section';
        sectionDiv.innerHTML = `<h4>${section}</h4><div class="vocab-tags" data-section="${section}"></div>`;
        const tagsContainer = sectionDiv.querySelector('.vocab-tags');
        tags.forEach(tag => {
            const tagBtn = document.createElement('span');
            tagBtn.className = 'vocab-tag';
            if (currentImageTags.includes(tag)) {
                tagBtn.classList.add('in-caption');
            }
            tagBtn.textContent = tag;
            tagBtn.addEventListener('click', () => toggleTagInCaption(tag));
            tagsContainer.appendChild(tagBtn);
        });
        sectionsDiv.appendChild(sectionDiv);
    }

    document.getElementById('editVocabBtn').addEventListener('click', () => {
        animateVocabTransition(() => {
            vocabEditMode = true;
            renderModalContent();
        });
    });
}

function toggleTagInCaption(tag) {
    const index = currentImageTags.indexOf(tag);
    if (index === -1) {
        currentImageTags.push(tag);
    } else {
        currentImageTags.splice(index, 1);
    }
    const newCaption = currentImageTags.join(', ');

    const textarea = document.getElementById('captionText');
    if (textarea) {
        textarea.value = newCaption;
        textarea.dispatchEvent(new Event('input'));
    } else {
        saveCaptionWithoutUI(newCaption);
    }

    if (vocabMode && !vocabEditMode) {
        const vocabSections = document.getElementById('vocabSections');
        const scrollPos = vocabSections ? vocabSections.scrollTop : 0;

        renderModalContent();

        requestAnimationFrame(() => {
            const newVocabSections = document.getElementById('vocabSections');
            if (newVocabSections) {
                newVocabSections.scrollTop = scrollPos;
            }
        });
    }
}

async function saveCaptionWithoutUI(caption) {
    const img = currentImages[currentImageIndex];
    if (!img) return;
    try {
        await fetch('/api/update-caption', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: img.filename, caption })
        });
        await updateInfoBadges(img);
        await refreshTagList();

        const imgObj = currentImagesRaw.find(i => i.filename === img.filename);
        if (imgObj) {
            imgObj.tag_count = currentImageTags.length;
        }
        updateImageCard(img.filename, currentImageTags.length);
    } catch (err) {
        console.error('Error saving caption:', err);
    }
}

function renderVocabEdit(container) {
    const vocabText = serializeVocabulary(vocabData, vocabOrder);

    container.innerHTML = `
        <textarea id="vocabEditText" class="vocab-edit-textarea" placeholder="${t('vocab_placeholder')}">${vocabText}</textarea>
        <div class="vocab-edit-actions">
            <button id="saveVocabBtn" class="btn-primary">${t('save')}</button>
            <button id="cancelVocabBtn" class="btn-secondary">${t('cancel')}</button>
        </div>
    `;

    document.getElementById('saveVocabBtn').addEventListener('click', async () => {
        const newText = document.getElementById('vocabEditText').value;
        const { obj: newVocab, order: newOrder } = parseVocabularyText(newText);
        vocabData = newVocab;
        vocabOrder = newOrder;
        await fetch(`/api/vocabulary/${encodeURIComponent(currentDatasetPath)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: vocabData })
        });
        animateVocabTransition(() => {
            vocabEditMode = false;
            renderModalContent();
        });
    });

    document.getElementById('cancelVocabBtn').addEventListener('click', () => {
        animateVocabTransition(() => {
            vocabEditMode = false;
            renderModalContent();
        });
    });
}

function parseVocabularyText(text) {
    const lines = text.split('\n');
    const result = {};
    const order = [];
    let currentSection = null;
    let currentTags = [];

    for (let line of lines) {
        line = line.trim();
        if (line.endsWith(':')) {
            if (currentSection) {
                result[currentSection] = [...new Set(currentTags)];
            }
            currentSection = line.slice(0, -1);
            order.push(currentSection);
            currentTags = [];
        } else if (line && currentSection) {
            const tags = line.split(',').map(t => t.trim()).filter(t => t);
            currentTags.push(...tags);
        }
    }
    if (currentSection) {
        result[currentSection] = [...new Set(currentTags)];
    }
    return { obj: result, order };
}

function animateVocabTransition(callback) {
    const captionDiv = document.querySelector('.modal-caption');
    if (!captionDiv) {
        callback();
        return;
    }
    captionDiv.classList.add('slide');
    setTimeout(() => {
        callback();
        setTimeout(() => {
            captionDiv.classList.remove('slide');
        }, 50);
    }, 200);
}

function serializeVocabulary(obj, order) {
    const sections = order || Object.keys(obj).sort();
    let text = '';
    for (let section of sections) {
        const tags = obj[section] || [];
        text += `${section}:\n`;
        text += tags.join(', ') + '\n\n';
    }
    return text.trim();
}

if (toggleVocabBtn) {
    toggleVocabBtn.addEventListener('click', () => {
        const captionDiv = document.querySelector('.modal-caption');
        vocabMode = !vocabMode;
        captionDiv.classList.add('slide');
        setTimeout(() => {
            renderModalContent();
            captionDiv.classList.remove('slide');
        }, 200);
    });
}

prevBtn.addEventListener('click', () => {
    if (currentImageIndex > 0) {
        currentImageIndex--;
        loadModalImage(currentImageIndex);
    }
});

nextBtn.addEventListener('click', () => {
    if (currentImageIndex < currentImages.length - 1) {
        currentImageIndex++;
        loadModalImage(currentImageIndex);
    }
});

navInput.addEventListener('change', () => {
    let val = parseInt(navInput.value, 10);
    if (val >= 1 && val <= currentImages.length) {
        currentImageIndex = val - 1;
        loadModalImage(currentImageIndex);
    } else {
        navInput.value = currentImageIndex + 1;
    }
});

function attachMassHandlers() {
    document.getElementById('bulkRenameBtn')?.addEventListener('click', async () => {
        if (!confirm(t('confirm_rename'))) return;
        await fetch('/api/bulk-rename', { method: 'POST' });
        alert(t('rename_complete'));
        if (document.querySelector('.tab-button.active').dataset.tab === 'point') {
            await refreshTagList();
            loadTagsAndImages();
        } else if (document.querySelector('.tab-button.active').dataset.tab === 'analysis') {
            refreshAnalysis();
        }
    });

    document.getElementById('bulkDeleteBtn')?.addEventListener('click', async () => {
        const tags = document.getElementById('deleteTagsInput').value.split(',').map(t => t.trim()).filter(t => t);
        if (!tags.length) return;
        await fetch('/api/bulk-delete-tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags })
        });
        alert(t('delete_complete'));
        document.getElementById('deleteTagsInput').value = '';
        if (document.querySelector('.tab-button.active').dataset.tab === 'point') {
            await refreshTagList();
            loadTagsAndImages();
        } else if (document.querySelector('.tab-button.active').dataset.tab === 'analysis') {
            refreshAnalysis();
        }
    });

    document.getElementById('bulkAddBtn')?.addEventListener('click', async () => {
        const tags = document.getElementById('addTagsInput').value.split(',').map(t => t.trim()).filter(t => t);
        if (!tags.length) return;
        let position = 'end';
        const radios = document.getElementsByName('addPosition');
        for (let radio of radios) {
            if (radio.checked) position = radio.value;
        }
        await fetch('/api/bulk-add-tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags, position })
        });
        alert(t('add_complete'));
        document.getElementById('addTagsInput').value = '';
        if (document.querySelector('.tab-button.active').dataset.tab === 'point') {
            await refreshTagList();
            loadTagsAndImages();
        } else if (document.querySelector('.tab-button.active').dataset.tab === 'analysis') {
            refreshAnalysis();
        }
    });

    document.getElementById('bulkReplaceBtn')?.addEventListener('click', async () => {
        const oldTag = document.getElementById('replaceOldInput').value.trim();
        const newTag = document.getElementById('replaceNewInput').value.trim();
        if (!oldTag || !newTag) return;
        await fetch('/api/bulk-replace-tag', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_tag: oldTag, new_tag: newTag })
        });
        alert(t('replace_complete'));
        document.getElementById('replaceOldInput').value = '';
        document.getElementById('replaceNewInput').value = '';
        if (document.querySelector('.tab-button.active').dataset.tab === 'point') {
            await refreshTagList();
            loadTagsAndImages();
        } else if (document.querySelector('.tab-button.active').dataset.tab === 'analysis') {
            refreshAnalysis();
        }
    });

    document.getElementById('backupBtn')?.addEventListener('click', async () => {
        if (!currentDatasetPath) {
            alert(t('no_dataset'));
            return;
        }
        const resp = await fetch('/api/backup/start', { method: 'POST' });
        const data = await resp.json();
        if (data.error) {
            alert(data.error);
            return;
        }
        backupActive = true;
        startBackupPolling();
        updateBackupButtonsUI();

        const statusResp = await fetch('/api/backup/status');
        const status = await statusResp.json();
        updateBackupProgressUI(status);
    });
}

async function loadAnalysisData() {
    const resp = await fetch('/api/get-analysis');
    analysisData = await resp.json();
    return analysisData;
}

async function initAnalysisTab() {
    if (!currentDatasetPath) {
        mainContent.innerHTML = `<p style="color: #888; text-align: center;">${t('no_dataset')}</p>`;
        return;
    }
    await loadAnalysisData();

    const gridElement = document.getElementById('widgetGrid');
    if (!gridElement) return;

    const savedLayout = await loadGlobalWidgetLayout();
    if (savedLayout && savedLayout.length > 0) {
        window.widgetData = savedLayout;
    } else {
        createDefaultLayout();
    }

    renderWidgets();
    updateGridRowHeight();

    document.getElementById('addWidgetBtn').addEventListener('click', openAddWidgetModal);
}

async function refreshAnalysis() {
    if (document.querySelector('.tab-button.active').dataset.tab !== 'analysis') return;
    await loadAnalysisData();
    document.querySelectorAll('.widget-item').forEach(el => {
        const id = el.id;
        const widget = window.widgetData.find(w => w.id === id);
        if (!widget) return;
        const contentDiv = el.querySelector('.widget-content');
        if (contentDiv) {
            if (window.widgetCharts.has(id)) {
                window.widgetCharts.get(id).destroy();
                window.widgetCharts.delete(id);
            }
            renderWidgetContent(contentDiv, widget.type, widget.options);
        }
    });
}

window.addEventListener('resize', () => {
    const activeTab = document.querySelector('.tab-button.active');
    if (activeTab && activeTab.dataset.tab === 'analysis') {
        updateGridRowHeight();
    }
});

async function populateLanguages() {
    const resp = await fetch('/api/languages');
    const langs = await resp.json();
    const select = document.getElementById('languageSelect');
    if (!select) return;
    select.innerHTML = '';
    langs.forEach(lang => {
        const option = document.createElement('option');
        option.value = lang;
        option.textContent = lang === 'ru' ? 'Русский' : (lang === 'en' ? 'English' : lang);
        select.appendChild(option);
    });
    const settingsResp = await fetch('/api/settings');
    const settings = await settingsResp.json();
    select.value = settings.language;

    refreshCustomSelect('#languageSelect');
}

let zoomActive = false;

function setupZoom() {
    const modalImageContainer = document.querySelector('.modal-image');
    const modalImg = document.getElementById('modalImg');

    if (!modalImageContainer || !modalImg) return;

    modalImageContainer.removeEventListener('mouseenter', onZoomEnter);
    modalImageContainer.removeEventListener('mousemove', onZoomMove);
    modalImageContainer.removeEventListener('mouseleave', onZoomLeave);

    if (!zoomEnabled) return;

    modalImageContainer.addEventListener('mouseenter', onZoomEnter);
    modalImageContainer.addEventListener('mousemove', onZoomMove);
    modalImageContainer.addEventListener('mouseleave', onZoomLeave);
}

function onZoomEnter(e) {
    const container = e.currentTarget;
    const img = container.querySelector('img');
    if (!img || !img.complete) return;

    zoomActive = true;
    container.classList.add('zoomed');
    updateZoomTransform(e, zoomFactor);
}

function onZoomMove(e) {
    if (!zoomActive) return;
    updateZoomTransform(e, zoomFactor);
}

function onZoomLeave(e) {
    zoomActive = false;
    const container = e.currentTarget;
    const img = container.querySelector('img');
    if (img) {
        img.style.transform = '';
        img.style.transformOrigin = '';
    }
    container.classList.remove('zoomed');
}

function updateZoomTransform(e, factor) {
    const container = e.currentTarget;
    const img = container.querySelector('img');
    if (!img) return;

    const rect = img.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    x = Math.max(0, Math.min(rect.width, x));
    y = Math.max(0, Math.min(rect.height, y));

    const percentX = (x / rect.width) * 100;
    const percentY = (y / rect.height) * 100;

    img.style.transformOrigin = `${percentX}% ${percentY}%`;
    img.style.transform = `scale(${factor})`;
}

function attachSettingsHandlers() {
    const languageSelect = document.getElementById('languageSelect');
    const colorPicker = document.getElementById('accentColorPicker');
    const workingDirInput = document.getElementById('workingDirectoryInput');
    const zoomEnabledCheck = document.getElementById('zoomEnabledCheckbox');
    const zoomFactorInput = document.getElementById('zoomFactorInput');

    (async () => {
        const resp = await fetch('/api/settings');
        const settings = await resp.json();
        if (workingDirInput) {
            workingDirInput.value = settings.working_directory || '';
        }
    })();

    async function saveAllSettings() {
        const lang = languageSelect.value;
        const color = colorPicker.value;
        const wd = workingDirInput ? workingDirInput.value : '';
        const zoomEnabledVal = zoomEnabledCheck ? zoomEnabledCheck.checked : true;
        const zoomFactorVal = zoomFactorInput ? parseFloat(zoomFactorInput.value) || 2 : 2;
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                language: lang,
                accent_color: color,
                working_directory: wd,
                zoom_enabled: zoomEnabledVal,
                zoom_factor: zoomFactorVal
            })
        });
        zoomEnabled = zoomEnabledVal;
        zoomFactor = zoomFactorVal;
    }

    languageSelect.addEventListener('change', async () => {
        const newLang = languageSelect.value;
        await saveAllSettings();
        currentLanguage = newLang;
        await loadTranslations(currentLanguage);
        applyTranslations();
        initCustomSelects();
    });

    colorPicker.addEventListener('input', (e) => {
        const newColor = e.target.value;
        document.documentElement.style.setProperty('--accent-color', newColor);
        const hoverColor = adjustColor(newColor, -20);
        document.documentElement.style.setProperty('--accent-hover', hoverColor);
        updateGradientVariables(newColor);
    });
    colorPicker.addEventListener('change', saveAllSettings);

    if (workingDirInput) {
        workingDirInput.addEventListener('change', saveAllSettings);
    }

    if (zoomEnabledCheck && zoomFactorInput) {
        zoomEnabledCheck.checked = zoomEnabled;
        zoomFactorInput.value = zoomFactor;
        zoomEnabledCheck.addEventListener('change', saveAllSettings);
        zoomFactorInput.addEventListener('input', saveAllSettings);
    }

    document.getElementById('resetRatingsBtn')?.addEventListener('click', async () => {
        if (!confirm(t('confirm_reset_ratings') || 'Вы уверены? Все сохранённые рейтинги будут удалены.')) return;
        try {
            const resp = await fetch('/api/reset-ratings', { method: 'POST' });
            const data = await resp.json();
            if (data.success) {
                location.reload();
            } else {
                alert('Ошибка: ' + (data.error || 'Неизвестная ошибка'));
            }
        } catch (err) {
            alert('Ошибка соединения: ' + err.message);
        }
    });
}

async function loadModels() {
    const resp = await fetch('/api/auto-models');
    const models = await resp.json();
    const select = document.getElementById('modelSelect');
    if (!select) return;
    select.innerHTML = '';
    if (models.length === 0) {
        select.innerHTML = '<option value="">' + t('no_models') + '</option>';
    } else {
        models.forEach(m => {
            const option = document.createElement('option');
            option.value = m;
            option.textContent = m;
            select.appendChild(option);
        });
    }
    refreshCustomSelect('#modelSelect');
}

function attachAutoHandlersToMass() {
    const thresholdSlider = document.getElementById('thresholdSlider');
    const thresholdSpan = document.getElementById('thresholdValue');
    const startBtn = document.getElementById('startAutoBtn');
    const stopBtn = document.getElementById('stopAutoBtn');
    const progressContainer = document.getElementById('progressContainer');

    if (thresholdSlider && thresholdSpan) {
        const updateSliderProgress = () => {
            const val = thresholdSlider.value;
            thresholdSpan.textContent = val;
            const percent = (val - thresholdSlider.min) / (thresholdSlider.max - thresholdSlider.min) * 100;
            thresholdSlider.style.setProperty('--fill-percent', percent + '%');
        };
        updateSliderProgress();
        thresholdSlider.addEventListener('input', updateSliderProgress);
    }

    startBtn?.addEventListener('click', async () => {
        const model = document.getElementById('modelSelect').value;
        if (!model) {
            alert(t('select_model'));
            return;
        }
        const threshold = parseFloat(thresholdSlider.value);
        const mode = document.getElementById('modeSelect').value;

        const resp = await fetch('/api/auto-tag/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, threshold, mode })
        });
        const data = await resp.json();
        if (data.error) {
            alert(data.error);
            return;
        }

        autoTaggingActive = true;
        startAutoStatusPolling();
        updateAutoButtonsUI();
        const statusResp = await fetch('/api/auto-tag/status');
        const status = await statusResp.json();
        updateAutoProgressUI(status);
    });

    stopBtn?.addEventListener('click', async () => {
        await fetch('/api/auto-tag/stop', { method: 'POST' });
        autoTaggingActive = false;
        stopAutoStatusPolling();
        updateAutoButtonsUI();
        if (progressContainer) progressContainer.style.display = 'none';
    });

    updateAutoButtonsUI();
    if (autoTaggingActive) {
        fetch('/api/auto-tag/status')
            .then(res => res.json())
            .then(status => updateAutoProgressUI(status));
    } else {
        if (progressContainer) progressContainer.style.display = 'none';
    }
}

(async function init() {
    await loadSettings();
    const targetTab = document.querySelector('.tab-button[data-tab="datasets"]');
    if (targetTab) {
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        targetTab.classList.add('active');
    }

    renderTab('datasets');

    fetch('/api/auto-tag/status')
        .then(res => res.json())
        .then(status => {
            if (status.running) {
                autoTaggingActive = true;
                const activeTab = document.querySelector('.tab-button.active').dataset.tab;
                if (activeTab === 'mass') {
                    startAutoStatusPolling();
                    updateAutoProgressUI(status);
                }
            }
        });

    fetch('/api/rating-analysis/status')
        .then(res => res.json())
        .then(status => {
            if (status.running) {
                startRatingPolling();
                updateRatingProgress(status);
            }
        });
})();toggleVocabBtn
