let currentDatasetPath = '';
let currentDatasetName = '';
window.currentDatasetPath = currentDatasetPath;
let currentImages = [];
let currentSettings = {};
let currentTags = [];
let selectedTags = [];
let currentImageIndex = 0;
let allTagsCounter = [];
let autoTaggingActive = false;
let autoStatusInterval = null;
let suspiciousZoomActive = false;
let currentLanguage = 'ru';
let translations = {};
let ratingRunning = false;
let backupActive = false;
let trainInProgress = false;
window.trainInProgress = trainInProgress;
let backupInterval = null;
let vocabOrder = [];
let zoomEnabled = true;
let analyzeActive = false;
let analyzeInterval = null;
let zoomFactor = 2;
let pendingDeleteFilename = null;
let semanticActive = false;
let semanticInterval = null;
let suspiciousIndex = 0;
let suspiciousResizeObserver = null;
let cropActive = false;
let cropInterval = null;
let suspiciousList = [];

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
    multipleNot: false,
    duplicates: false
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

function isValidIP(ip) {
    if (ip === 'localhost' || ip === '0.0.0.0') return true;
    const ipRegex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipRegex.test(ip);
}

function setBodyHeight() {
    document.body.style.height = window.innerHeight + 'px';
}
setBodyHeight();
window.addEventListener('resize', setBodyHeight);

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

async function loadYoloModels() {
    const resp = await fetch('/api/semantic/yolo-models');
    const models = await resp.json();
    const select = document.getElementById('yoloModelSelect');
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
    refreshCustomSelect('#yoloModelSelect');
}

async function loadClipModels() {
    const resp = await fetch('/api/semantic/clip-models');
    const models = await resp.json();
    const select = document.getElementById('encoderModelSelect');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '';
    if (models.length === 0) {
        select.innerHTML = '<option value="">' + t('no_models') + '</option>';
    } else {
        select.innerHTML = '';
        models.forEach(m => {
            const option = document.createElement('option');
            option.value = m;
            option.textContent = m;
            select.appendChild(option);
        });
    }
    if (currentVal && models.includes(currentVal)) select.value = currentVal;
    refreshCustomSelect('#encoderModelSelect');
}

async function loadDinov2Models() {
    const resp = await fetch('/api/semantic/dinov2-models');
    const models = await resp.json();
    const select = document.getElementById('encoderModelSelect');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '';
    if (models.length === 0) {
        select.innerHTML = '<option value="">' + t('no_models') + '</option>';
    } else {
        select.innerHTML = '';
        models.forEach(m => {
            const option = document.createElement('option');
            option.value = m;
            option.textContent = m;
            select.appendChild(option);
        });
    }
    if (currentVal && models.includes(currentVal)) select.value = currentVal;
    refreshCustomSelect('#encoderModelSelect');
}

async function populateYoloSelects() {
    const resp = await fetch('/api/semantic/yolo-models');
    const models = await resp.json();
    const selects = ['yoloHandsModelSelect', 'yoloFaceModelSelect', 'yoloEyesModelSelect', 'yoloFeetModelSelect'];
    selects.forEach(selId => {
        const select = document.getElementById(selId);
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="">' + t('not_use') + '</option>';
        models.forEach(m => {
            const option = document.createElement('option');
            option.value = m;
            option.textContent = m;
            select.appendChild(option);
        });
        if (currentVal && models.includes(currentVal)) select.value = currentVal;
        refreshCustomSelect(`#${selId}`);
    });
}

function onEncoderChange() {
    const encoderSelect = document.getElementById('encoderSelect');
    const modelGroup = document.getElementById('encoderModelGroup');
    if (!encoderSelect || !modelGroup) return;
    const encoder = encoderSelect.value;
    if (encoder === 'clip') {
        modelGroup.style.display = 'block';
        loadClipModels();
    } else if (encoder === 'dinov2') {
        modelGroup.style.display = 'block';
        loadDinov2Models();
    } else {
        modelGroup.style.display = 'none';
    }
}

function initSemanticSliders() {
    const autoSlider = document.getElementById('autoThresholdSlider');
    const autoSpan = document.getElementById('autoThresholdValue');
    const suspSlider = document.getElementById('suspiciousThresholdSlider');
    const suspSpan = document.getElementById('suspiciousThresholdValue');
    if (autoSlider && autoSpan) {
        const updateAuto = () => {
            autoSpan.textContent = autoSlider.value;
            autoSlider.style.setProperty('--fill-percent', ((autoSlider.value - autoSlider.min) / (autoSlider.max - autoSlider.min) * 100) + '%');
        };
        updateAuto();
        autoSlider.addEventListener('input', updateAuto);
    }
    if (suspSlider && suspSpan) {
        const updateSusp = () => {
            suspSpan.textContent = suspSlider.value;
            suspSlider.style.setProperty('--fill-percent', ((suspSlider.value - suspSlider.min) / (suspSlider.max - suspSlider.min) * 100) + '%');
        };
        updateSusp();
        suspSlider.addEventListener('input', updateSusp);
    }
}

async function startSemanticFilter() {
    if (!currentDatasetPath) {
        alert(t('no_dataset'));
        return;
    }
    const detectors = [];
    const yolo_models = {};

    const handsModel = document.getElementById('yoloHandsModelSelect').value;
    if (handsModel) {
        detectors.push('hands_yolo');
        yolo_models.hands_yolo = handsModel;
    }
    const faceModel = document.getElementById('yoloFaceModelSelect').value;
    if (faceModel) {
        detectors.push('face_yolo');
        yolo_models.face_yolo = faceModel;
    }
    const eyesModel = document.getElementById('yoloEyesModelSelect').value;
    if (eyesModel) {
        detectors.push('eyes_yolo');
        yolo_models.eyes_yolo = eyesModel;
    }
    const feetModel = document.getElementById('yoloFeetModelSelect').value;
    if (feetModel) {
        detectors.push('feet_yolo');
        yolo_models.feet_yolo = feetModel;
    }

    const encoder = document.getElementById('encoderSelect').value;
    let encoderModel = null;
    if (encoder !== '') {
        encoderModel = document.getElementById('encoderModelSelect').value;
    }
    const autoThreshold = parseFloat(document.getElementById('autoThresholdSlider').value);
    const suspiciousThreshold = parseFloat(document.getElementById('suspiciousThresholdSlider').value);

    const yolo_thresholds = {};
    if (document.getElementById('yoloHandsModelSelect').value) {
        yolo_thresholds.hands_yolo = parseFloat(document.getElementById('yoloHandsThreshold').value) || 0.5;
    }
    if (document.getElementById('yoloFaceModelSelect').value) {
        yolo_thresholds.face_yolo = parseFloat(document.getElementById('yoloFaceThreshold').value) || 0.5;
    }
    if (document.getElementById('yoloEyesModelSelect').value) {
        yolo_thresholds.eyes_yolo = parseFloat(document.getElementById('yoloEyesThreshold').value) || 0.5;
    }
    if (document.getElementById('yoloFeetModelSelect').value) {
        yolo_thresholds.feet_yolo = parseFloat(document.getElementById('yoloFeetThreshold').value) || 0.5;
    }

    const autoTaggerModel = document.getElementById('autoTaggerModelSelect').value;
    const autoTaggerThreshold = parseFloat(document.getElementById('autoTaggerThresholdSlider').value);

    const userModelHands = document.getElementById('userModelHandsSelect').value;
    const userModelFace = document.getElementById('userModelFaceSelect').value;
    const userModelEyes = document.getElementById('userModelEyesSelect').value;
    const userModelFeet = document.getElementById('userModelFeetSelect').value;

    const clipUncertaintyMargin = parseFloat(document.getElementById('uncertaintyMarginSlider').value);

    const payload = {
        detectors,
        yolo_models,
        yolo_thresholds,
        encoder: encoder || null,
        encoder_model: encoderModel,
        thresholds: {
            auto: autoThreshold,
            suspicious: suspiciousThreshold
        },
        auto_tagger_model: autoTaggerModel || null,
        auto_tagger_threshold: autoTaggerThreshold,
        user_model_hands_yolo: userModelHands || null,
        user_model_face_yolo: userModelFace || null,
        user_model_eyes_yolo: userModelEyes || null,
        user_model_feet_yolo: userModelFeet || null,
        clip_uncertainty_margin: clipUncertaintyMargin
    };

    const resp = await fetch('/api/semantic/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (data.error) {
        alert(data.error);
        return;
    }
    startSemanticPolling();
}

async function stopSemanticFilter() {
    await fetch('/api/semantic/stop', { method: 'POST' });
    stopSemanticPolling();
    document.getElementById('semanticProgressContainer').style.display = 'none';
    document.getElementById('startSemanticBtn').disabled = false;
    document.getElementById('stopSemanticBtn').disabled = true;
}

let semanticPollInterval = null;
function startSemanticPolling() {
    if (semanticPollInterval) return;
    semanticPollInterval = setInterval(async () => {
        const resp = await fetch('/api/semantic/status');
        const status = await resp.json();
        updateSemanticProgress(status);
        if (!status.running) {
            stopSemanticPolling();
            document.getElementById('startSemanticBtn').disabled = false;
            document.getElementById('stopSemanticBtn').disabled = true;
            if (status.suspicious_count > 0) {
                showSuspiciousReviewModal();
            } else if (status.bad_count > 0) {
                alert(`Фильтрация завершена. Отмечено как плохие: ${status.bad_count} файлов.`);
            } else {
                alert('Фильтрация завершена. Все изображения признаны хорошими.');
            }
        } else {
            document.getElementById('startSemanticBtn').disabled = true;
            document.getElementById('stopSemanticBtn').disabled = false;
        }
    }, 500);
}
function stopSemanticPolling() {
    if (semanticPollInterval) {
        clearInterval(semanticPollInterval);
        semanticPollInterval = null;
    }
}

function updateSemanticProgress(status) {
    const container = document.getElementById('semanticProgressContainer');
    const fill = document.getElementById('semanticProgressFill');
    const current = document.getElementById('semanticCurrentFile');
    if (!container || !fill) return;

    if (status.running && status.total > 0) {
        container.style.display = 'block';

        const percent = (status.processed / status.total) * 100;
        fill.style.width = '0%';
        void fill.offsetWidth;
        fill.style.width = percent + '%';

        current.textContent = status.current_file || t('idle');
    } else if (!status.running) {
        container.style.display = 'none';
    } else {
        container.style.display = 'none';
    }
    console.log('Semantic status:', status);
}

async function loadUserModels() {
    const resp = await fetch('/api/semantic/user-models');
    const models = await resp.json();
    const select = document.getElementById('userModelSelect');
    if (!select) return;
    select.innerHTML = '<option value="">' + t('no_model') + '</option>';
    models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.id} (${m.encoder || '?'})`;
        select.appendChild(opt);
    });
    refreshCustomSelect('#userModelSelect');
}

async function updateAllUserModelSelects() {
    const encoder = document.getElementById('encoderSelect').value;
    const encoderModel = document.getElementById('encoderModelSelect').value;
    const detectors = [
        { selectId: 'userModelHandsSelect', targetType: 'hand' },
        { selectId: 'userModelFaceSelect', targetType: 'face' },
        { selectId: 'userModelEyesSelect', targetType: 'eye' },
        { selectId: 'userModelFeetSelect', targetType: 'foot' }
    ];
    for (const det of detectors) {
        const select = document.getElementById(det.selectId);
        if (!select) continue;
        let url = `/api/semantic/user-models?encoder=${encoder}&target_type=${det.targetType}`;
        if (encoderModel) url += `&model_name=${encodeURIComponent(encoderModel)}`;
        const resp = await fetch(url);
        const models = await resp.json();
        select.innerHTML = '<option value="">' + t('no_model') + '</option>';
        models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = `${m.user_model_name} (${m.created.slice(0,10)})`;
            select.appendChild(opt);
        });
        refreshCustomSelect(`#${det.selectId}`);
    }
}

function showTrainModal() {
    if (window.trainInProgress) {
        alert(t('training_already_in_progress') || 'Обучение уже запущено. Дождитесь завершения.');
        return;
    }

    const modalDiv = document.createElement('div');
    modalDiv.className = 'modal show';
    modalDiv.id = 'trainModal';
    modalDiv.innerHTML = `
        <div class="modal-content modal-large">
            <div class="modal-body" style="display: flex; gap: 24px; padding: 24px; padding-bottom: 10px;">
                <div class="left-col" style="flex: 2; min-width: 0;">
                    <div class="form-group">
                        <label>${t('good_images')}</label>
                        <div id="goodDropZone" class="cover-upload-area" style="min-height: 150px;">
                            <div class="cover-placeholder">
                                <span>📷</span>
                                <p>${t('drag_hint')}</p>
                            </div>
                        </div>
                        <div id="goodPreview" style="margin-top: 8px; font-size: 12px;"></div>
                    </div>
                    <div class="form-group" style="margin-top: 16px;">
                        <label>${t('bad_images')}</label>
                        <div id="badDropZone" class="cover-upload-area" style="min-height: 150px;">
                            <div class="cover-placeholder">
                                <span>📷</span>
                                <p>${t('drag_bad_hint')}</p>
                            </div>
                        </div>
                        <div id="badPreview" style="margin-top: 8px; font-size: 12px;"></div>
                    </div>
                    <div class="form-group" style="margin-top: 16px;">
                        <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 12px;">
                            <p style="margin: 0; font-size: 13px; color: var(--text-secondary);">
                                <strong>ℹ️ ${t('info_important')}</strong>
                            </p>
                        </div>
                    </div>
                </div>

                <div class="right-col" style="flex: 1; min-width: 0;">
                    <div class="form-group">
                        <label>${t('model_name_label')}</label>
                        <input type="text" id="userModelName" class="mass-input" placeholder="my_hand_model" required>
                    </div>
                    <div class="form-group">
                        <label>${t('encoder_label')}</label>
                        <select id="trainEncoderSelect" class="custom-select">
                            <option value="clip">CLIP</option>
                            <option value="dinov2">DINOv2</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>${t('encoder_model_label')}</label>
                        <select id="trainEncoderModelSelect" class="custom-select"></select>
                    </div>
                    <div class="form-group">
                        <label>${t('target_type_label')}</label>
                        <select id="trainTargetType" class="custom-select">
                            <option value="hand">${t('hand')}</option>
                            <option value="face">${t('face')}</option>
                            <option value="eye">${t('eye')}</option>
                            <option value="foot">${t('foot')}</option>
                        </select>
                    </div>
                    <div style="display: flex; gap: 12px; margin-top: 24px;">
                        <button id="trainCancelBtn" class="btn-secondary" style="flex: 1;">${t('cancel')}</button>
                        <button id="trainSubmitBtn" class="btn-primary" style="flex: 1;">${t('train')}</button>
                    </div>
                </div>
            </div>
            <!-- Футер  -->
            <div class="modal-footer" style="justify-content: flex-start; padding: 18px 18px 18px 18px;">
                <div id="trainProgress" style="display:none; width: 100%;">
                    <div class="progress-bar"><div id="trainProgressFill" style="width:0%"></div></div>
                    <p id="trainStatusText"></p>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modalDiv);
    modalDiv.classList.add('show');

    let goodFiles = [];
    let badFiles = [];

    async function loadTrainEncoderModels() {
        const encoder = document.getElementById('trainEncoderSelect').value;
        const select = document.getElementById('trainEncoderModelSelect');
        if (encoder === 'clip') {
            const resp = await fetch('/api/semantic/clip-models');
            const models = await resp.json();
            select.innerHTML = '';
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                select.appendChild(opt);
            });
        } else if (encoder === 'dinov2') {
            const resp = await fetch('/api/semantic/dinov2-models');
            const models = await resp.json();
            select.innerHTML = '';
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                select.appendChild(opt);
            });
        }
        refreshCustomSelect('#trainEncoderModelSelect');
    }
    document.getElementById('trainEncoderSelect').addEventListener('change', loadTrainEncoderModels);
    loadTrainEncoderModels();

    function setupDropZone(zoneId, filesArray, previewId) {
        const zone = document.getElementById(zoneId);
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('dragover');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
            filesArray.push(...files);
            updatePreview(previewId, filesArray);
        });
        zone.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = 'image/*';
            input.onchange = () => {
                const files = Array.from(input.files);
                filesArray.push(...files);
                updatePreview(previewId, filesArray);
            };
            input.click();
        });
    }

    function updatePreview(containerId, files) {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = files.length ? `${t('loaded_files')}: ${files.length}` : '—';
        }
    }

    setupDropZone('goodDropZone', goodFiles, 'goodPreview');
    setupDropZone('badDropZone', badFiles, 'badPreview');

    async function train() {
        const submitBtn = document.getElementById('trainSubmitBtn');
        if (window.trainInProgress) {
            alert(t('training_already_in_progress') || 'Обучение уже запущено.');
            return;
        }
        window.trainInProgress = true;
        submitBtn.disabled = true;

        const userModelName = document.getElementById('userModelName').value.trim();
        const targetType = document.getElementById('trainTargetType').value;
        const encoder = document.getElementById('trainEncoderSelect').value;
        const encoderModel = document.getElementById('trainEncoderModelSelect').value;
        if (!userModelName) {
            alert(t('enter_model_name'));
            window.trainInProgress = false;
            submitBtn.disabled = false;
            return;
        }
        if (goodFiles.length === 0 || badFiles.length === 0) {
            alert(t('need_good_bad'));
            window.trainInProgress = false;
            submitBtn.disabled = false;
            return;
        }
        const formData = new FormData();
        goodFiles.forEach(f => formData.append('good', f));
        badFiles.forEach(f => formData.append('bad', f));
        formData.append('encoder', encoder);
        formData.append('target_type', targetType);
        formData.append('user_model_name', userModelName);
        if (encoderModel) formData.append('model_name', encoderModel);

        const progressDiv = document.getElementById('trainProgress');
        const progressFill = document.getElementById('trainProgressFill');
        const statusText = document.getElementById('trainStatusText');
        progressDiv.style.display = 'block';
        statusText.textContent = t('sending');
        progressFill.style.width = '0%';

        try {
            const resp = await fetch('/api/semantic/train', {
                method: 'POST',
                body: formData
            });
            const data = await resp.json();
            if (data.success) {
                statusText.textContent = t('train_complete');
                progressFill.style.width = '100%';
                setTimeout(() => {
                    modalDiv.remove();
                    if (typeof updateAllUserModelSelects === 'function') {
                        updateAllUserModelSelects();
                    }
                    window.trainInProgress = false;
                }, 1000);
            } else {
                alert(t('error_occurred') + ': ' + (data.error || t('unknown_error')));
                modalDiv.remove();
                window.trainInProgress = false;
            }
        } catch (err) {
            alert(t('connection_error') + ': ' + err.message);
            modalDiv.remove();
            window.trainInProgress = false;
        }
    }

    function handleCancel() {
        if (window.trainInProgress) {
            if (confirm('Обучение уже запущено. Закрытие окна не остановит процесс. Продолжить?')) {
                modalDiv.remove();
            }
        } else {
            modalDiv.remove();
        }
    }

    document.getElementById('trainCancelBtn').onclick = handleCancel;
    document.getElementById('trainSubmitBtn').onclick = train;

    modalDiv.addEventListener('click', (e) => {
        if (e.target === modalDiv) {
            if (window.trainInProgress) {
                if (confirm('Обучение уже запущено. Закрытие окна не остановит процесс. Продолжить?')) {
                    modalDiv.remove();
                }
            } else {
                modalDiv.remove();
            }
        }
    });
}

async function loadAutoTaggerModels() {
    const resp = await fetch('/api/auto-models');
    const models = await resp.json();
    const select = document.getElementById('autoTaggerModelSelect');
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
    refreshCustomSelect('#autoTaggerModelSelect');
}

function attachSemanticHandlers() {
    const startBtn = document.getElementById('startSemanticBtn');
    const stopBtn = document.getElementById('stopSemanticBtn');
    const trainBtn = document.getElementById('trainModelBtn');
    const encoderSelect = document.getElementById('encoderSelect');
    const encoderModelSelect = document.getElementById('encoderModelSelect');

    if (startBtn) startBtn.addEventListener('click', startSemanticFilter);
    if (stopBtn) stopBtn.addEventListener('click', stopSemanticFilter);
    if (trainBtn) trainBtn.addEventListener('click', showTrainModal);
    if (encoderSelect) encoderSelect.addEventListener('change', () => {
        onEncoderChange();
        updateAllUserModelSelects();
    });
    if (encoderModelSelect) encoderModelSelect.addEventListener('change', updateAllUserModelSelects);

    initSemanticSliders();
    loadYoloModels();
    loadUserModels();
    loadAutoTaggerModels();
    onEncoderChange();
    updateAllUserModelSelects();

    const autoSlider = document.getElementById('autoTaggerThresholdSlider');
    const autoSpan = document.getElementById('autoTaggerThresholdValue');
    if (autoSlider && autoSpan) {
        const updateAuto = () => {
            autoSpan.textContent = autoSlider.value;
            autoSlider.style.setProperty('--fill-percent', ((autoSlider.value - autoSlider.min) / (autoSlider.max - autoSlider.min) * 100) + '%');
        };
        updateAuto();
        autoSlider.addEventListener('input', updateAuto);
    }

    const marginSlider = document.getElementById('uncertaintyMarginSlider');
    const marginSpan = document.getElementById('uncertaintyMarginValue');
    if (marginSlider && marginSpan) {
        const updateMargin = () => {
            marginSpan.textContent = parseFloat(marginSlider.value).toFixed(2);
            const percent = ((marginSlider.value - marginSlider.min) / (marginSlider.max - marginSlider.min) * 100);
            marginSlider.style.setProperty('--fill-percent', percent + '%');
        };
        updateMargin();
        marginSlider.addEventListener('input', updateMargin);
    }

    document.querySelectorAll('.expandable-section .section-header').forEach(header => {
        const targetId = header.getAttribute('data-toggle');
        const content = document.getElementById(targetId);
        if (content) {
            header.addEventListener('click', () => {
                const isOpen = header.classList.contains('open');
                if (isOpen) {
                    header.classList.remove('open');
                    content.classList.remove('open');
                } else {
                    header.classList.add('open');
                    content.classList.add('open');
                }
            });
            header.classList.remove('open');
            content.classList.remove('open');
        }
    });
}

async function showSuspiciousReviewModal() {
    const suspResp = await fetch('/api/semantic/suspicious');
    const suspicious = await suspResp.json();
    if (!suspicious.length) return;
    suspiciousList = suspicious;
    suspiciousIndex = 0;

    let modalDiv = document.getElementById('suspiciousModal');
    if (!modalDiv) {
        modalDiv = document.createElement('div');
        modalDiv.id = 'suspiciousModal';
        modalDiv.className = 'modal';
        modalDiv.innerHTML = `
            <div class="modal-content">
                <div class="modal-body" style="display: flex; gap: 28px; padding: 28px;">
                    <div class="modal-image" style="flex: 0 0 70%; position: relative;">
                        <img id="suspiciousImg" style="max-width: 100%; max-height: 60vh; object-fit: contain;">
                    </div>
                    <div class="modal-info" style="flex: 0 0 30%; padding: 16px; display: flex; flex-direction: column; gap: 12px;">
                        <h3>${t('suspicious_image')}</h3>
                        <div><strong>${t('defect_confidence')}:</strong> <span id="suspiciousDefectConfidence"></span></div>

                        <!-- YOLO статистика -->
                        <div id="suspiciousYoloStats" class="suspicious-stats" style="margin-top: 8px;"></div>

                        <!-- Контекст сцены (теги) в текстовом поле -->
                        <div>
                            <strong>${t('scene_context')}:</strong>
                            <pre id="suspiciousDetails" style="white-space: pre-wrap; font-size: 12px; background: var(--bg-tertiary); padding: 8px; border-radius: 12px; overflow: auto; max-height: 200px; margin-top: 6px;"></pre>
                        </div>
                    </div>
                </div>
                <div class="modal-footer" style="justify-content: space-between; padding: 20px 28px;">
                    <span id="suspiciousCounter"></span>
                    <div style="display: flex; gap: 12px;">
                        <button id="suspiciousGoodBtn" class="btn-primary">${t('good')}</button>
                        <button id="suspiciousBadBtn" class="btn-danger">${t('bad')}</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modalDiv);
    }

    let canvas = document.getElementById('suspiciousCanvas');
    if (!canvas) {
        const modalImage = modalDiv.querySelector('.modal-image');
        canvas = document.createElement('canvas');
        canvas.id = 'suspiciousCanvas';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        modalImage.appendChild(canvas);
    }

    loadSuspiciousItem(0);
    setupSuspiciousZoom();
    modalDiv.classList.add('show');
    attachSuspiciousHandlers();
    attachSuspiciousResizeObserver();

    modalDiv.addEventListener('click', (e) => {
        if (e.target === modalDiv) {
            closeSuspiciousModalAndMarkAllGood();
        }
    });

    document.addEventListener('keydown', suspiciousKeyHandler);
}

async function closeSuspiciousModalAndMarkAllGood() {
    if (suspiciousList.length === 0) {
        closeSuspiciousModal();
        return;
    }
    for (const item of suspiciousList) {
        await fetch('/api/semantic/mark-good', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: item.filename })
        });
    }
    closeSuspiciousModal();
}

function loadSuspiciousItem(index) {
    const item = suspiciousList[index];
    if (!item) return;

    const canvas = document.getElementById('suspiciousCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
        canvas.style.opacity = '1';
    }

    suspiciousZoomActive = false;
    const modal = document.getElementById('suspiciousModal');
    if (modal) {
        const container = modal.querySelector('.modal-image');
        const img = modal.querySelector('#suspiciousImg');
        if (container) container.classList.remove('zoomed');
        if (img) {
            img.style.transform = '';
            img.style.transformOrigin = '';
        }
        const canvas = modal.querySelector('#suspiciousCanvas');
        if (canvas) {
            canvas.style.opacity = '1';
            canvas.width = 0;
            canvas.height = 0;
        }
    }

    const imgEl = document.getElementById('suspiciousImg');
    if (imgEl) {
        imgEl.src = `/api/image/${encodeURIComponent(item.filename)}?t=${Date.now()}`;
        imgEl.onload = () => {
            drawBoundingBoxes(imgEl, item.visual_data || {});
        };
    }

    const yoloStatsDiv = document.getElementById('suspiciousYoloStats');
    if (yoloStatsDiv && item.detections && item.expected_counts) {
        const detections = item.detections;
        const expected = item.expected_counts;
        let yoloHtml = '<strong>YOLO:</strong><ul style="margin: 6px 0 0 20px; padding: 0;">';

        const mapping = {
            'hands_yolo': { name: t('hand_plural') || 'рук', expKey: 'hands' },
            'face_yolo': { name: t('face_plural') || 'лиц', expKey: 'face' },
            'eyes_yolo': { name: t('eye_plural') || 'глаз', expKey: 'eyes' },
            'feet_yolo': { name: t('foot_plural') || 'ступней', expKey: 'feet' }
        };

        for (const [detKey, detData] of Object.entries(detections)) {
            if (detData.count !== undefined && mapping[detKey]) {
                const { name, expKey } = mapping[detKey];
                const count = detData.count;
                const expectedCount = expected[expKey] !== undefined ? expected[expKey] : '?';
                yoloHtml += `<li>${t('detected')} ${name}: ${count} (${expectedCount})</li>`;
            }
        }
        yoloHtml += '</ul>';
        yoloStatsDiv.innerHTML = yoloHtml;
    } else if (yoloStatsDiv) {
        yoloStatsDiv.innerHTML = '<strong>YOLO:</strong> нет данных';
    }

    const detailsPre = document.getElementById('suspiciousDetails');
    if (detailsPre && item.tags) {
        const significantTagsSet = new Set(item.significant_tags || []);
        const tagsHtml = item.tags.map(tag => {
            if (significantTagsSet.has(tag)) {
                return `<strong>${escapeHtml(tag)}</strong>`;
            }
            return escapeHtml(tag);
        }).join(', ');
        detailsPre.innerHTML = tagsHtml || '—';
    } else if (detailsPre) {
        detailsPre.innerHTML = '—';
    }

    const qualitySpan = document.getElementById('suspiciousQuality');
    const defectSpan = document.getElementById('suspiciousDefectConfidence');
    if (qualitySpan) {
        qualitySpan.textContent = (item.overall_score !== undefined ? (item.overall_score * 100).toFixed(0) + '%' : '—');
    }
    if (defectSpan) {
        defectSpan.textContent = (item.defect_confidence !== undefined ? (item.defect_confidence * 100).toFixed(0) + '%' : '—');
    }

    const counterSpan = document.getElementById('suspiciousCounter');
    if (counterSpan) {
        counterSpan.textContent = `${index+1} из ${suspiciousList.length}`;
    }
}

function drawBoundingBoxes(imgElement, visualData) {
    if (!imgElement.complete || imgElement.naturalWidth === 0) {
            imgElement.onload = () => drawBoundingBoxes(imgElement, visualData);
            return;
        }
    const canvas = document.getElementById('suspiciousCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (suspiciousZoomActive) return;

    if (!imgElement.complete || imgElement.naturalWidth === 0) {
        imgElement.onload = () => drawBoundingBoxes(imgElement, visualData);
        return;
    }

    const dpr = window.devicePixelRatio || 1;
    const imgRect = imgElement.getBoundingClientRect();
    const naturalW = imgElement.naturalWidth;
    const naturalH = imgElement.naturalHeight;

    const scale = Math.min(imgRect.width / naturalW, imgRect.height / naturalH);
    const displayW = naturalW * scale;
    const displayH = naturalH * scale;
    const offsetX = (imgRect.width - displayW) / 2;
    const offsetY = (imgRect.height - displayH) / 2;

    canvas.width = imgRect.width * dpr;
    canvas.height = imgRect.height * dpr;
    canvas.style.width = `${imgRect.width}px`;
    canvas.style.height = `${imgRect.height}px`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, imgRect.width, imgRect.height);

    ctx.lineWidth = 2.5;
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.shadowBlur = 0;

    const colors = {
        hands_yolo: '#00ccff', hands: '#00ccff',
        face_yolo: '#ff4444', face: '#ff4444',
        eyes_yolo: '#ffff00', eyes: '#ffff00',
        feet_yolo: '#ff8800', feet: '#ff8800'
    };
    const labels = {
        hands_yolo: t('hand'), hands: t('hand'),
        face_yolo: t('face'), face: t('face'),
        eyes_yolo: t('eye'), eyes: t('eye'),
        feet_yolo: t('foot'), feet: t('foot')
    };

    for (const [detector, data] of Object.entries(visualData)) {
        if (!data.boxes || data.boxes.length === 0) continue;
        const color = colors[detector] || '#ffffff';
        ctx.strokeStyle = color;
        ctx.fillStyle = color;

        data.boxes.forEach((box, idx) => {
            const [x1_px, y1_px, x2_px, y2_px] = box;
            const confidence = box.length > 4 ? box[4] : null;

            const x1 = x1_px * scale + offsetX;
            const y1 = y1_px * scale + offsetY;
            const x2 = x2_px * scale + offsetX;
            const y2 = y2_px * scale + offsetY;
            const w = x2 - x1;
            const h = y2 - y1;
            if (w <= 0 || h <= 0) return;

            ctx.beginPath();
            ctx.rect(x1, y1, w, h);
            ctx.stroke();

            let labelText = `${labels[detector] || detector} #${idx + 1}`;
            if (confidence !== null) {
                labelText += ` (${(confidence * 100).toFixed(0)}%)`;
            }
            ctx.fillStyle = color;
            ctx.shadowBlur = 5;
            ctx.shadowColor = 'black';
            ctx.fillText(labelText, x1 + 2, y1 - 4);
            ctx.shadowBlur = 0;
        });
    }

    if (visualData.region_scores) {
        for (const region of visualData.region_scores) {
            const box = region.box;
            const regionScore = region.region_score;
            const [x1_px, y1_px, x2_px, y2_px] = box;
            const x1 = x1_px * scale + offsetX;
            const y1 = y1_px * scale + offsetY;
            const x2 = x2_px * scale + offsetX;
            const y2 = y2_px * scale + offsetY;
            const w = x2 - x1;
            const h = y2 - y1;
            if (w <= 0 || h <= 0) continue;

            const qualityPercent = (regionScore * 100).toFixed(0);
            const qualityColor = regionScore > 0.5 ? '#ff6666' : '#66ff66';
            ctx.fillStyle = qualityColor;
            ctx.fillText(`${t('artifact_confidence')}: ${qualityPercent}%`, x1 + 2, y2 + 16);
        }
    }
}

function attachSuspiciousResizeObserver() {
    const imgEl = document.getElementById('suspiciousImg');
    const container = document.querySelector('#suspiciousModal .modal-image');
    if (!imgEl || !container) return;
    if (suspiciousResizeObserver) suspiciousResizeObserver.disconnect();
    suspiciousResizeObserver = new ResizeObserver(() => {
        if (!suspiciousZoomActive) {
            const item = suspiciousList[suspiciousIndex];
            if (item) drawBoundingBoxes(imgEl, item.visual_data || {});
        }
    });
    suspiciousResizeObserver.observe(container);
}

function suspiciousKeyHandler(e) {
    if (e.key === 'ArrowLeft') {
        if (suspiciousIndex > 0) {
            suspiciousIndex--;
            loadSuspiciousItem(suspiciousIndex);
        }
    } else if (e.key === 'ArrowRight') {
        if (suspiciousIndex < suspiciousList.length - 1) {
            suspiciousIndex++;
            loadSuspiciousItem(suspiciousIndex);
        }
    } else if (e.key === 'Escape') {
        closeSuspiciousModalAndMarkAllGood();
    }
}

function closeSuspiciousModal() {
    const modalDiv = document.getElementById('suspiciousModal');
    if (modalDiv) modalDiv.classList.remove('show');
    if (suspiciousResizeObserver) {
        suspiciousResizeObserver.disconnect();
        suspiciousResizeObserver = null;
    }
    const canvas = document.getElementById('suspiciousCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.opacity = '1';
    }
    document.removeEventListener('keydown', suspiciousKeyHandler);
}

async function handleSuspiciousDecision(decision) {
    const item = suspiciousList[suspiciousIndex];
    if (!item) return;
    if (decision === 'bad') {
        const resp = await fetch('/api/semantic/mark-bad', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: item.filename })
        });
        if (!resp.ok) alert('Ошибка перемещения');
    } else {
        await fetch('/api/semantic/mark-good', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: item.filename })
        });
    }
    suspiciousList.splice(suspiciousIndex, 1);
    if (suspiciousList.length === 0) {
        closeSuspiciousModal();
    } else {
        if (suspiciousIndex >= suspiciousList.length) suspiciousIndex = suspiciousList.length - 1;
        loadSuspiciousItem(suspiciousIndex);
    }
}

function attachSuspiciousHandlers() {
    const goodBtn = document.getElementById('suspiciousGoodBtn');
    const badBtn = document.getElementById('suspiciousBadBtn');
    if (goodBtn) goodBtn.onclick = () => handleSuspiciousDecision('good');
    if (badBtn) badBtn.onclick = () => handleSuspiciousDecision('bad');
}

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

function startAnalyzePolling() {
    if (analyzeInterval) return;
    analyzeInterval = setInterval(async () => {
        const resp = await fetch('/api/analyze/status');
        const status = await resp.json();
        updateAnalyzeProgress(status);
        if (!status.running) {
            analyzeActive = false;
            stopAnalyzePolling();
            updateAnalyzeButtons();
            handleAnalyzeComplete();
        } else {
            analyzeActive = true;
        }
    }, 300);
}

function stopAnalyzePolling() {
    if (analyzeInterval) {
        clearInterval(analyzeInterval);
        analyzeInterval = null;
    }
}

function updateAnalyzeProgress(status) {
    const container = document.getElementById('analyzeProgressContainer');
    const fill = document.getElementById('analyzeProgressFill');
    const current = document.getElementById('analyzeCurrentFile');
    if (container) {
        if (status.total > 0) {
            const percent = (status.processed / status.total) * 100;
            fill.style.width = percent + '%';
            current.textContent = status.current_file || t('idle');
        }
        container.style.display = status.running ? 'block' : 'none';
    }

    const overlayFill = document.getElementById('analyzeOverlayProgressFill');
    const overlayPercent = document.getElementById('analyzeOverlayPercent');
    const overlayCurrent = document.getElementById('analyzeOverlayCurrentFile');
    if (overlayFill && overlayPercent && overlayCurrent) {
        if (status.total > 0) {
            const percent = (status.processed / status.total) * 100;
            overlayFill.style.width = percent + '%';
            overlayPercent.textContent = Math.round(percent) + '%';
            overlayCurrent.textContent = status.current_file || '';
        }
    }
}

function showAnalyzeOverlay(show) {
    const overlay = document.getElementById('analyzeOverlay');
    const gridContainer = document.querySelector('.image-grid-container');
    const tagContainer = document.querySelector('.tag-list-container');
    if (!overlay) return;
    if (show) {
        overlay.style.display = 'flex';
        if (gridContainer) gridContainer.style.display = 'none';
        if (tagContainer) tagContainer.style.display = 'none';
    } else {
        overlay.style.display = 'none';
        if (gridContainer) gridContainer.style.display = '';
        if (tagContainer) tagContainer.style.display = '';
    }
}

async function handleAnalyzeComplete() {
    analyzeActive = false;
    stopAnalyzePolling();
    updateAnalyzeButtons();
    await reloadDuplicateData();
    const activeTab = document.querySelector('.tab-button.active').dataset.tab;
    if (activeTab === 'point' && currentDatasetPath) {
        showAnalyzeOverlay(false);
        loadTagsAndImages();
    }
}

function updateAnalyzeButtons() {
    const startBtn = document.getElementById('startAnalyzeBtn');
    const stopBtn = document.getElementById('stopAnalyzeBtn');
    if (startBtn) startBtn.disabled = analyzeActive;
    if (stopBtn) stopBtn.disabled = !analyzeActive;
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

window.resetLoadedDataset = function() {
    currentDatasetPath = '';
    window.currentDatasetPath = '';
    currentImages = [];
    currentImagesRaw = [];

    const pathInput = document.getElementById('datasetPath');
    if (pathInput) pathInput.value = '';

    const countSpan = document.getElementById('imageCount');
    if (countSpan) countSpan.textContent = '0';

    const grid = document.getElementById('imageGrid');
    if (grid) grid.innerHTML = '';

    const tagList = document.getElementById('tagList');
    if (tagList) tagList.innerHTML = '';

    const analysisPanel = document.querySelector('.analysis-panel');
    if (analysisPanel) {
        analysisPanel.innerHTML = `<p style="color: #888; text-align: center;">${t('no_dataset')}</p>`;
    }
};

window.loadDatasetByPath = async function(path) {
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
    window.currentDatasetPath = path;
    const pathInput = document.getElementById('datasetPath');
    if (pathInput) pathInput.value = path;
    const countSpan = document.getElementById('imageCount');
    if (countSpan) countSpan.textContent = data.count;
    startRatingPolling();

    const similarResp = await fetch('/api/similar-pairs');
    window.similarPairs = similarResp.ok ? await similarResp.json() : [];
    const duplicateGroupsResp = await fetch('/api/duplicates');
    window.duplicateGroups = duplicateGroupsResp.ok ? await duplicateGroupsResp.json() : [];

    const activeTab = document.querySelector('.tab-button.active').dataset.tab;
    if (activeTab === 'point') {
        renderTab('point');
    } else if (activeTab === 'analysis') {
        renderTab('analysis');
    }
};

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

    const batchSizeInput = document.getElementById('batchSizeInput');
    if (batchSizeInput && settings.batch_size !== undefined) {
        batchSizeInput.value = settings.batch_size;
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
        if (status.error) {
            alert(status.error);
            stopAutoStatusPolling();
            updateAutoButtonsUI();
        }
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

    if (status.running) {
        progressContainer.style.display = 'block';
        if (status.loading_model) {
            currentFileEl.textContent = 'Загрузка модели...';
            progressFill.style.width = '0%';
        } else if (status.total > 0) {
            const percent = (status.processed / status.total) * 100;
            progressFill.style.width = percent + '%';
            if (status.current_file === 'Подготовка к обработке...') {
                currentFileEl.textContent = status.current_file;
            } else {
                currentFileEl.textContent = status.current_file || t('idle');
            }
        }
    } else {
        progressContainer.style.display = 'none';
    }
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

    const wasRunning = ratingRunning;
    ratingRunning = status.running && status.total > 0;

    if (status.running && status.total > 0) {
        container.style.display = 'flex';
        const fill = document.getElementById('ratingProgressFill');
        const current = document.getElementById('ratingCurrentFile');
        const percent = (status.processed / status.total) * 100;
        fill.style.width = percent + '%';
        current.textContent = status.current_file || '';
    }

    if (wasRunning !== ratingRunning) {
        const activeTab = document.querySelector('.tab-button.active');
        if (activeTab && activeTab.dataset.tab === 'mass') {
            updateMassButtonsState(ratingRunning);
        }
    }
}

function updateMassButtonsState(disable) {
    const buttonIds = [
        'bulkRenameBtn',
        'bulkDeleteBtn',
        'bulkAddBtn',
        'bulkReplaceBtn',
        'backupBtn',
        'startAutoBtn',
        'stopAutoBtn',
        'startSemanticBtn',
        'stopSemanticBtn',
        'trainModelBtn',
        'startCropBtn',
        'stopCropBtn',
        'startAnalyzeBtn'
    ];

    buttonIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = disable;
    });

    const extraSelectors = [
        '#trainModelBtn',
        '.mass-panel .btn-primary',
        '.mass-panel .btn-secondary'
    ];
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
        populateYoloSelects();
        loadYoloModels();
        attachAutoHandlersToMass();
        attachSemanticHandlers();
        loadUserModels();
        initCustomSelects();
        updateMassButtonsState(ratingRunning);

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
        attachFilterHandlers();
        if (currentDatasetPath) {
            fetch('/api/analyze/status')
                .then(res => res.json())
                .then(status => {
                    if (status.running) {
                        analyzeActive = true;
                        showAnalyzeOverlay(true);
                        startAnalyzePolling();
                        updateAnalyzeProgress(status);
                    } else {
                        showAnalyzeOverlay(false);
                        loadTagsAndImages();
                    }
                });
        } else {
            if (imageGrid) imageGrid.innerHTML = `<p style="color: #888; text-align: center;">${t('no_dataset')}</p>`;
        }
        stopAutoStatusPolling();
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
            <!-- Карточка Auto crop -->
            <div class="mass-panel" style="flex: 1 1 400px;">
                <h3 data-i18n="auto_crop_card">Auto crop</h3>
                <div class="form-group">
                    <label data-i18n="crop_folder">Папка для кропов</label>
                    <input type="text" id="cropFolderName" class="mass-input" placeholder="cropped_parts">
                </div>
                <div class="form-group">
                    <label data-i18n="yolo_model_select">YOLO модель</label>
                    <select id="cropModelSelect" class="custom-select"></select>
                </div>
                <div class="form-group">
                    <label data-i18n="yolo_model_threshold">Порог уверенности: <span id="cropThresholdValue">0.5</span></label>
                    <input type="range" id="cropThresholdSlider" min="0" max="1" step="0.01" value="0.5">
                </div>
                <div class="button-group">
                    <button id="startCropBtn" class="btn-primary" data-i18n="start">Запустить кроппинг</button>
                    <button id="stopCropBtn" class="btn-secondary" data-i18n="stop" disabled>Остановить</button>
                </div>
                <div id="cropProgressContainer" style="margin-top:20px; display:none;">
                    <div class="progress-bar"><div id="cropProgressFill" style="width:0%"></div></div>
                    <p id="cropCurrentFile"></p>
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

            <!-- Карточка семантического фильтра -->
            <div class="mass-panel" style="flex: 1 1 400px;">
                <h3 data-i18n="semantic_filter">Семантический фильтр</h3>

                <!-- Аккордеон 1: YOLO детекторы -->
                <div class="expandable-section">
                    <div class="section-header" data-toggle="yolo-section">
                        <span class="section-title" data-i18n="yolo_detectors">YOLO детекторы</span>
                        <span class="toggle-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </span>
                    </div>
                    <div class="section-content" id="yolo-section">
                        <!-- Руки -->
                        <div class="form-group">
                            <label data-i18n="yolo_model_for_hands">YOLO модель для рук</label>
                            <div style="display: flex; gap: 8px;">
                                <select id="yoloHandsModelSelect" class="custom-select" style="flex: 1;">
                                    <option value="">-- Не использовать --</option>
                                </select>
                                <input type="number" id="yoloHandsThreshold" class="yolo-threshold" step="0.01" min="0.01" max="1" value="0.5" style="width: 80px;" placeholder="порог">
                            </div>
                        </div>
                        <!-- Лица -->
                        <div class="form-group">
                            <label data-i18n="yolo_model_for_face">YOLO модель для лиц</label>
                            <div style="display: flex; gap: 8px;">
                                <select id="yoloFaceModelSelect" class="custom-select" style="flex: 1;">
                                    <option value="">-- Не использовать --</option>
                                </select>
                                <input type="number" id="yoloFaceThreshold" class="yolo-threshold" step="0.01" min="0.01" max="1" value="0.5" style="width: 80px;" placeholder="порог">
                            </div>
                        </div>
                        <!-- Глаза -->
                        <div class="form-group">
                            <label data-i18n="yolo_model_for_eyes">YOLO модель для глаз</label>
                            <div style="display: flex; gap: 8px;">
                                <select id="yoloEyesModelSelect" class="custom-select" style="flex: 1;">
                                    <option value="">-- Не использовать --</option>
                                </select>
                                <input type="number" id="yoloEyesThreshold" class="yolo-threshold" step="0.01" min="0.01" max="1" value="0.5" style="width: 80px;" placeholder="порог">
                            </div>
                        </div>
                        <!-- Ступни -->
                        <div class="form-group">
                            <label data-i18n="yolo_model_for_feet">YOLO модель для ступней</label>
                            <div style="display: flex; gap: 8px;">
                                <select id="yoloFeetModelSelect" class="custom-select" style="flex: 1;">
                                    <option value="">-- Не использовать --</option>
                                </select>
                                <input type="number" id="yoloFeetThreshold" class="yolo-threshold" step="0.01" min="0.01" max="1" value="0.5" style="width: 80px;" placeholder="порог">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Аккордеон 2: Пользовательские классификаторы -->
                <div class="expandable-section">
                    <div class="section-header" data-toggle="user-models-section">
                        <span class="section-title" data-i18n="classifiers">Классификаторы</span>
                        <span class="toggle-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </span>
                    </div>
                    <div class="section-content" id="user-models-section">
                        <div class="form-group">
                            <label data-i18n="model_for_hands">Модель для рук</label>
                            <select id="userModelHandsSelect" class="custom-select">
                                <option value="">-- Без модели --</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label data-i18n="model_for_face">Модель для лиц</label>
                            <select id="userModelFaceSelect" class="custom-select">
                                <option value="">-- Без модели --</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label data-i18n="model_for_eyes">Модель для глаз</label>
                            <select id="userModelEyesSelect" class="custom-select">
                                <option value="">-- Без модели --</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label data-i18n="model_for_feet">Модель для ступней</label>
                            <select id="userModelFeetSelect" class="custom-select">
                                <option value="">-- Без модели --</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <button id="trainModelBtn" class="btn-primary" data-i18n="train_classifier" style="width: 100%;">Обучить классификатор</button>
                        </div>
                    </div>
                </div>

                <!-- Аккордеон 3: Автотеггер для контекста -->
                <div class="expandable-section">
                    <div class="section-header" data-toggle="auto-tagger-section">
                        <span class="section-title" data-i18n="auto_tagger_context">Автотеггер для контекста</span>
                        <span class="toggle-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </span>
                    </div>
                    <div class="section-content" id="auto-tagger-section">
                        <div class="form-group">
                            <label data-i18n="auto_tagger_model">Модель автотеггера</label>
                            <select id="autoTaggerModelSelect" class="custom-select"></select>
                        </div>
                        <div class="form-group">
                            <label><span data-i18n="auto_tagger_threshold">Порог автотеггера</span> <span id="autoTaggerThresholdValue">0.35</span></label>
                            <input type="range" id="autoTaggerThresholdSlider" min="0" max="1" step="0.01" value="0.35">
                        </div>
                    </div>
                </div>

                <!-- Остальные элементы (энкодер, общие пороги, кнопки) -->
                <div class="form-group">
                    <label data-i18n="encoder_for_semantic">Энкодер (для семантики)</label>
                    <select id="encoderSelect" class="custom-select">
                        <option value="">${t('no_semantic')}</option>
                        <option value="clip">CLIP</option>
                        <option value="dinov2">DINOv2</option>
                    </select>
                </div>
                <div class="form-group" id="encoderModelGroup" style="display: none;">
                    <label data-i18n="encoder_model">Модель энкодера</label>
                    <select id="encoderModelSelect" class="custom-select"></select>
                </div>

                <div class="form-group">
                    <label><span data-i18n="auto_threshold">Автоматический порог:</span> <span id="autoThresholdValue">0.85</span></label>
                    <input type="range" id="autoThresholdSlider" min="0" max="1" step="0.01" value="0.90">
                </div>
                <div class="form-group">
                    <label><span data-i18n="suspicious_threshold">Порог для спорных:</span> <span id="suspiciousThresholdValue">0.70</span></label>
                    <input type="range" id="suspiciousThresholdSlider" min="0" max="1" step="0.01" value="0.70">
                </div>

                <!-- Новый слайдер для зоны неопределённости CLIP -->
                <div class="form-group">
                    <label><span data-i18n="clip_uncertainty_margin">Зона неопределённости CLIP:</span> <span id="uncertaintyMarginValue">0.10</span></label>
                    <input type="range" id="uncertaintyMarginSlider" min="0" max="0.2" step="0.02" value="0.1">
                    <small data-i18n="clip_uncertainty_help">Оценки CLIP в диапазоне 0.5 ± (значение/2) игнорируются</small>
                </div>

                <div class="button-group">
                    <button id="startSemanticBtn" class="btn-primary" data-i18n="start_filter">Запустить фильтр</button>
                    <button id="stopSemanticBtn" class="btn-secondary" disabled data-i18n="stop_filter">Остановить</button>
                </div>

                <div id="semanticProgressContainer" style="margin-top:20px; display:none;">
                    <div class="progress-bar"><div id="semanticProgressFill" style="width:0%"></div></div>
                    <p id="semanticCurrentFile"></p>
                </div>
            </div>

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

                    <div class="filter-section">
                        <h4 data-i18n="duplicates">Дубликаты</h4>
                        <label class="custom-checkbox">
                            <input type="checkbox" id="filterDuplicates" class="filter-duplicates">
                            <span class="checkmark"></span>
                            <span data-i18n="show_duplicates_only">Показывать только дубликаты</span>
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
            <!-- Оверлей загрузки анализа -->
            <div id="analyzeOverlay" class="analyze-overlay" style="display: none;">
                <div class="analyze-content">
                    <div class="analyze-spinner"></div>
                    <div class="analyze-progress">
                        <div class="progress-bar-large">
                            <div id="analyzeOverlayProgressFill" style="width:0%"></div>
                        </div>
                        <span id="analyzeOverlayPercent">0%</span>
                    </div>
                    <span id="analyzeOverlayCurrentFile"></span>
                </div>
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

            <h3 data-i18n="server_settings">Настройки сервера</h3>
            <div id="qrCodeContainer" style="display: none; margin-top: 20px; margin-bottom: 10px; text-align: center">
                <img id="qrCodeImg" src="" alt="QR Code" style="max-width: 200px; border-radius: 16px; display: inline-block;">
            </div>
            <div class="form-group">
                <label data-i18n="server_host">IP-адрес (по умолчанию 127.0.0.1)</label>
                <input type="text" id="serverHostInput" placeholder="127.0.0.1" value="">
            </div>
            <div class="form-group">
                <label data-i18n="server_port">Порт (по умолчанию 5000)</label>
                <input type="text" id="serverPortInput" placeholder="5000" value="">
            </div>

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

            <hr style="margin: 24px 0; border: 1px solid var(--border-color);">

            <h3 data-i18n="optimize_settings_title">Оптимиизация</h3>
            <div class="form-group">
                <label data-i18n="optimize_batch_size">Размер батча</label>
                <input type="number" id="batchSizeInput" min="1" max="128" step="1" value="8">
                <small data-i18n="optimize_help_label">Для мощных GPU можно увеличить (например, 16-32). Слишком большое значение может вызвать ошибку памяти.</small>
            </div>

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
    window.loadDatasetByPath(path);
});

async function reloadDuplicateData() {
    try {
        const similarResp = await fetch('/api/similar-pairs');
        if (similarResp.ok) window.similarPairs = await similarResp.json();
        const duplicateResp = await fetch('/api/duplicates');
        if (duplicateResp.ok) window.duplicateGroups = await duplicateResp.json();
    } catch (e) {
        console.error('Ошибка загрузки данных о дубликатах:', e);
    }
}

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
    const duplicateCheckbox = document.getElementById('filterDuplicates');
    const resetBtn = document.getElementById('resetFiltersBtn');

    if (duplicateCheckbox) {
        duplicateCheckbox.checked = filters.duplicates || false;
        duplicateCheckbox.addEventListener('change', collectAndApply);
    }

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

        if (duplicateCheckbox) {
            filters.duplicates = duplicateCheckbox.checked;
        }

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
        if (duplicateCheckbox) duplicateCheckbox.checked = false;

        filters = {
            ratings: [],
            minW: null,
            maxW: null,
            minH: null,
            maxH: null,
            aspects: [],
            multiple32: false,
            multiple64: false,
            multipleNot: false,
            duplicates: false
        };

        applyFilters();
    });
}

function buildDuplicateComponents(images, similarPairs, duplicateGroups) {
    const filenames = images.map(img => img.filename);
    const filenameSet = new Set(filenames);
    const graph = {};

    const addEdge = (a, b) => {
        if (!graph[a]) graph[a] = [];
        if (!graph[b]) graph[b] = [];
        if (!graph[a].includes(b)) graph[a].push(b);
        if (!graph[b].includes(a)) graph[b].push(a);
    };

    similarPairs.forEach(p => {
        if (filenameSet.has(p.filename1) && filenameSet.has(p.filename2)) {
            addEdge(p.filename1, p.filename2);
        }
    });

    duplicateGroups.forEach(group => {
        const files = group.files.filter(f => filenameSet.has(f));
        for (let i = 0; i < files.length; i++) {
            for (let j = i + 1; j < files.length; j++) {
                addEdge(files[i], files[j]);
            }
        }
    });

    const visited = new Set();
    const components = [];

    for (let f of filenames) {
        if (!visited.has(f) && graph[f]) {
            const stack = [f];
            const component = [];
            while (stack.length) {
                const node = stack.pop();
                if (visited.has(node)) continue;
                visited.add(node);
                component.push(node);
                if (graph[node]) {
                    for (let neighbor of graph[node]) {
                        if (!visited.has(neighbor)) {
                            stack.push(neighbor);
                        }
                    }
                }
            }
            components.push(component);
        }
    }

    return components;
}

function buildDuplicateGroups(images, similarPairs) {
    const filenames = images.map(img => img.filename);
    const filenameSet = new Set(filenames);
    const relevantPairs = similarPairs.filter(p => filenameSet.has(p.filename1) && filenameSet.has(p.filename2));
    const graph = {};
    relevantPairs.forEach(p => {
        if (!graph[p.filename1]) graph[p.filename1] = [];
        if (!graph[p.filename2]) graph[p.filename2] = [];
        graph[p.filename1].push(p.filename2);
        graph[p.filename2].push(p.filename1);
    });
    const visited = new Set();
    const groups = [];
    for (let f of filenames) {
        if (!visited.has(f) && graph[f]) {
            const stack = [f];
            const component = [];
            while (stack.length) {
                const node = stack.pop();
                if (visited.has(node)) continue;
                visited.add(node);
                component.push(node);
                if (graph[node]) {
                    for (let neighbor of graph[node]) {
                        if (!visited.has(neighbor)) {
                            stack.push(neighbor);
                        }
                    }
                }
            }
            if (component.length > 1) {
                groups.push(component);
            }
        }
    }
    return groups;
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
    const countSpan = document.getElementById('imageCount');
    if (countSpan) countSpan.textContent = currentImagesRaw.length;
}

function applyFilters() {
    if (!currentImagesRaw.length) {
        currentImages = [];
        renderImageGrid(currentImages);
        return;
    }

    let filtered = currentImagesRaw.filter(img => {
        if (filters.ratings.length > 0 && !filters.ratings.includes(img.rating)) return false;
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

    if (filters.duplicates) {
        const components = buildDuplicateComponents(filtered, window.similarPairs, window.duplicateGroups);
        const duplicateComponents = components.filter(comp => comp.length > 1);
        const orderedFilenames = [];
        duplicateComponents.forEach(comp => {
            comp.sort((a, b) => a.localeCompare(b));
            orderedFilenames.push(...comp);
        });
        const filenameToImg = new Map(filtered.map(img => [img.filename, img]));
        currentImages = orderedFilenames.map(fname => filenameToImg.get(fname)).filter(img => img);
    } else {
        currentImages = filtered;
    }

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

    let qualityData = null;
    try {
        const qResp = await fetch(`/api/image-quality/${encodeURIComponent(img.filename)}`);
        qualityData = await qResp.json();
    } catch (e) {
        console.error('Ошибка получения качества:', e);
    }

    let width = img.width || 0;
    let height = img.height || 0;
    let aspect = '?';
    let mult32 = false;
    let mult64 = false;
    let overallQuality = null;

    if (qualityData && qualityData.width) {
        width = qualityData.width;
        height = qualityData.height;
        aspect = qualityData.aspect_ratio;
        mult32 = qualityData.multiple_32;
        mult64 = qualityData.multiple_64;
        overallQuality = qualityData.overall_quality;
    } else {
        if (width && height) {
            const ratio = width / height;
            const aspects = {
                '1:1': 1.0, '4:3': 4/3, '3:4': 3/4,
                '16:9': 16/9, '9:16': 9/16,
                '2:3': 2/3, '3:2': 3/2,
                '21:9': 21/9, '9:21': 9/21,
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
        mult32 = (width % 32 === 0 && height % 32 === 0);
        mult64 = (width % 64 === 0 && height % 64 === 0);
    }

    let ratingBadgeClass = rating === 'general' || rating === 'sensitive' ? 'green' : 'red';
    let ratingText = rating === 'general' ? 'PG' : (rating === 'sensitive' ? 'PG-13' : (rating === 'questionable' ? 'R' : 'XXX'));

    let badgesHtml = `
        <span class="badge ${ratingBadgeClass}">${ratingText}</span>
        <span class="badge">${width}x${height}</span>
        <span class="badge">${aspect}</span>
        <span class="badge ${mult32 ? 'green' : 'red'}">${mult32 ? t('multiple_32') : t('not_multiple_32')}</span>
    `;
    if (mult64) {
        badgesHtml += `<span class="badge green">${t('multiple_64')}</span>`;
    }

    if (overallQuality !== null) {
        let sharp_norm = Math.min(qualityData.sharpness / 30.0, 1.0) * 100;
        let res_perc = qualityData.resolution_score * 100;
        let no_artifacts = (1 - qualityData.jpeg_artifacts) * 100;
        let no_noise = (1 - qualityData.noise_level) * 100;
        let mult_bonus = (mult32 || mult64) ? 4 : 0;

        let sharp_contrib = (0.15 * sharp_norm).toFixed(1);
        let res_contrib = (0.65 * res_perc).toFixed(1);
        let art_contrib = (0.08 * no_artifacts).toFixed(1);
        let noise_contrib = (0.08 * no_noise).toFixed(1);
        let mult_contrib = mult_bonus.toFixed(1);

        let tooltip = `${t('sharpness')}: ${sharp_contrib}% (15%)\n` +
                      `${t('resolution')}: ${res_contrib}% (65%)\n` +
                      `${t('artifacts')}: ${art_contrib}% (8%)\n` +
                      `${t('noise')}: ${noise_contrib}% (8%)\n` +
                      `${t('multiplicity_bonus')}: ${mult_contrib}% (4%)\n` +
                      `${t('total')}: ${overallQuality.toFixed(1)}%`;

        let qualityClass = overallQuality < 65 ? 'red' : (overallQuality < 80 ? 'yellow' : 'green');
        badgesHtml += `<span class="badge ${qualityClass}" title="${tooltip}">${t('quality')}: ${overallQuality.toFixed(0)}%</span>`;
    }

    try {
        const similarResp = await fetch(`/api/similar/${encodeURIComponent(img.filename)}`);
        const similarList = await similarResp.json();
        if (similarList.length > 0) {
            const topSim = similarList.slice(0, 3);
            let tooltip = t('similar_images') + ':\n' + topSim.map(s => `${s.filename} (${(s.similarity*100).toFixed(0)}%)`).join('\n');
            badgesHtml += `<span class="badge red" title="${tooltip}">${t('duplicate')}</span>`;
        }
    } catch (e) {
        console.error('Ошибка получения похожих:', e);
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

async function updateQRCode() {
    const container = document.getElementById('qrCodeContainer');
    const img = document.getElementById('qrCodeImg');
    if (!container || !img) return;
    try {
        const resp = await fetch('/api/qr-code');
        if (resp.status === 200) {
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            img.src = url;
            container.style.display = 'block';
            img.onload = () => URL.revokeObjectURL(url);
        } else {
            container.style.display = 'none';
            img.src = '';
        }
    } catch (e) {
        console.error('QR error:', e);
        container.style.display = 'none';
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
        const currentPath = '';
        const resp = await fetch('/api/bulk-rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: currentPath })
        });
        if (!resp.ok) {
            const errorData = await resp.json();
            alert('Ошибка: ' + (errorData.error || 'Неизвестная ошибка'));
            return;
        }
        alert(t('rename_complete'));
        await reloadDuplicateData();
        const activeTab = document.querySelector('.tab-button.active').dataset.tab;
        if (activeTab === 'point') {
            await refreshTagList();
            loadTagsAndImages();
        } else if (activeTab === 'analysis') {
            refreshAnalysis();
        }
    });

    document.getElementById('startAnalyzeBtn')?.addEventListener('click', async () => {
        if (!currentDatasetPath) {
            alert(t('no_dataset'));
            return;
        }
        const resp = await fetch('/api/analyze/start', { method: 'POST' });
        const data = await resp.json();
        if (data.error) {
            alert(data.error);
            return;
        }
        analyzeActive = true;
        startAnalyzePolling();
        updateAnalyzeButtons();
        const statusResp = await fetch('/api/analyze/status');
        const status = await statusResp.json();
        updateAnalyzeProgress(status);
    });

    document.getElementById('stopAnalyzeBtn')?.addEventListener('click', async () => {
        await fetch('/api/analyze/stop', { method: 'POST' });
        analyzeActive = false;
        stopAnalyzePolling();
        updateAnalyzeButtons();
        const container = document.getElementById('analyzeProgressContainer');
        if (container) container.style.display = 'none';
    });

    document.getElementById('bulkDeleteBtn')?.addEventListener('click', async () => {
        const tags = document.getElementById('deleteTagsInput').value.split(',').map(t => t.trim()).filter(t => t);
        if (!tags.length) return;
        await fetch('/api/bulk-delete-tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags })
        });
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

    async function loadCropModels() {
        const resp = await fetch('/api/semantic/yolo-models');
        const models = await resp.json();
        const select = document.getElementById('cropModelSelect');
        if (!select) return;
        select.innerHTML = '';
        models.forEach(m => {
            const option = document.createElement('option');
            option.value = m;
            option.textContent = m;
            select.appendChild(option);
        });
        refreshCustomSelect('#cropModelSelect');
    }
    loadCropModels();

    const cropThresholdSlider = document.getElementById('cropThresholdSlider');
    const cropThresholdSpan = document.getElementById('cropThresholdValue');
    if (cropThresholdSlider && cropThresholdSpan) {
        const updateCropThreshold = () => {
            cropThresholdSpan.textContent = cropThresholdSlider.value;
            const percent = ((cropThresholdSlider.value - cropThresholdSlider.min) / (cropThresholdSlider.max - cropThresholdSlider.min) * 100);
            cropThresholdSlider.style.setProperty('--fill-percent', percent + '%');
        };
        updateCropThreshold();
        cropThresholdSlider.addEventListener('input', updateCropThreshold);
    }

    const startCropBtn = document.getElementById('startCropBtn');
    const stopCropBtn = document.getElementById('stopCropBtn');

    startCropBtn?.addEventListener('click', async () => {
        const folder = document.getElementById('cropFolderName').value.trim();
        const model = document.getElementById('cropModelSelect').value;
        const threshold = parseFloat(cropThresholdSlider.value);
        if (!folder) {
            alert('Укажите название папки для кропов');
            return;
        }
        if (!model) {
            alert('Выберите YOLO модель');
            return;
        }
        const resp = await fetch('/api/auto-crop/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder, model, threshold })
        });
        const data = await resp.json();
        if (data.error) {
            alert(data.error);
            return;
        }
        cropActive = true;
        startCropPolling();
        updateCropButtons();
    });

    stopCropBtn?.addEventListener('click', async () => {
        await fetch('/api/auto-crop/stop', { method: 'POST' });
        cropActive = false;
        stopCropPolling();
        updateCropButtons();
        const container = document.getElementById('cropProgressContainer');
        if (container) container.style.display = 'none';
    });

    function startCropPolling() {
        if (cropInterval) return;
        cropInterval = setInterval(async () => {
            const resp = await fetch('/api/auto-crop/status');
            const status = await resp.json();
            updateCropProgress(status);
            if (!status.running) {
                cropActive = false;
                stopCropPolling();
                updateCropButtons();
                if (status.error) alert('Ошибка: ' + status.error);
            }
        }, 500);
    }

    function stopCropPolling() {
        if (cropInterval) {
            clearInterval(cropInterval);
            cropInterval = null;
        }
    }

    function updateCropProgress(status) {
        const container = document.getElementById('cropProgressContainer');
        const fill = document.getElementById('cropProgressFill');
        const current = document.getElementById('cropCurrentFile');
        if (!container) return;
        if (status.running) {
            container.style.display = 'block';
            const percent = status.total > 0 ? (status.processed / status.total) * 100 : 0;
            fill.style.width = '0%';
            void fill.offsetWidth;
            fill.style.width = percent + '%';
            current.textContent = status.current_file || '';
        } else {
            container.style.display = 'none';
        }
    }

    function updateCropButtons() {
        const startBtn = document.getElementById('startCropBtn');
        const stopBtn = document.getElementById('stopCropBtn');
        if (startBtn) startBtn.disabled = cropActive;
        if (stopBtn) stopBtn.disabled = !cropActive;
    }

    updateMassButtonsState(ratingRunning);
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

function setupSuspiciousZoom() {
    const modal = document.getElementById('suspiciousModal');
    if (!modal) return;
    const container = modal.querySelector('.modal-image');
    const img = modal.querySelector('#suspiciousImg');
    if (!container || !img) return;

    container.removeEventListener('mouseenter', onSuspiciousZoomEnter);
    container.removeEventListener('mousemove', onSuspiciousZoomMove);
    container.removeEventListener('mouseleave', onSuspiciousZoomLeave);

    if (!zoomEnabled) return;

    let zoomTransitionTimeout = null;

    function onSuspiciousZoomEnter(e) {
        if (!img.complete) return;
        suspiciousZoomActive = true;

        if (zoomTransitionTimeout) {
            clearTimeout(zoomTransitionTimeout);
            zoomTransitionTimeout = null;
        }

        const canvas = modal.querySelector('#suspiciousCanvas');
        if (canvas) canvas.style.opacity = '0';
        container.classList.add('zoomed');
        updateSuspiciousZoomTransform(e, zoomFactor);
    }

    function onSuspiciousZoomMove(e) {
        if (!suspiciousZoomActive) return;
        updateSuspiciousZoomTransform(e, zoomFactor);
    }

    function onSuspiciousZoomLeave() {
        suspiciousZoomActive = false;

        const modal = document.getElementById('suspiciousModal');
        if (!modal) return;
        const container = modal.querySelector('.modal-image');
        const img = modal.querySelector('#suspiciousImg');
        const canvas = modal.querySelector('#suspiciousCanvas');
        if (!container || !img) return;

        container.classList.remove('zoomed');
        img.style.transform = '';

        if (canvas) {
            canvas.style.opacity = '0';
            canvas.width = 0;
            canvas.height = 0;
        }
        const onTransitionEnd = () => {
            img.removeEventListener('transitionend', onTransitionEnd);

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (!suspiciousZoomActive) {
                        const item = suspiciousList[suspiciousIndex];
                        if (item && img && img.complete && img.naturalWidth > 0) {
                            drawBoundingBoxes(img, item.visual_data || {});
                            if (canvas) canvas.style.opacity = '1';
                        } else if (canvas) {
                            canvas.style.opacity = '1';
                        }
                    }
                    zoomTransitionTimeout = null;
                });
            });
        };

        img.addEventListener('transitionend', onTransitionEnd, { once: true });

        zoomTransitionTimeout = setTimeout(() => {
            img.removeEventListener('transitionend', onTransitionEnd);
            onTransitionEnd();
        }, 300);
    }

    function updateSuspiciousZoomTransform(e, factor) {
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

    container.addEventListener('mouseenter', onSuspiciousZoomEnter);
    container.addEventListener('mousemove', onSuspiciousZoomMove);
    container.addEventListener('mouseleave', onSuspiciousZoomLeave);
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
    const serverHostInput = document.getElementById('serverHostInput');
    const serverPortInput = document.getElementById('serverPortInput');
    const batchSizeInput = document.getElementById('batchSizeInput');

    async function refreshSettingsUI() {
        const resp = await fetch('/api/settings');
        const settings = await resp.json();

        if (languageSelect) languageSelect.value = settings.language || 'ru';
        if (colorPicker) colorPicker.value = settings.accent_color || '#3b82f6';
        if (workingDirInput) workingDirInput.value = settings.working_directory || '';
        if (zoomEnabledCheck) zoomEnabledCheck.checked = settings.zoom_enabled !== undefined ? settings.zoom_enabled : true;
        if (zoomFactorInput) zoomFactorInput.value = settings.zoom_factor || 2;
        if (serverHostInput) serverHostInput.value = settings.server_host || '';
        if (serverPortInput) serverPortInput.value = settings.server_port || '';
        if (batchSizeInput) batchSizeInput.value = settings.batch_size || 8;

        document.documentElement.style.setProperty('--accent-color', settings.accent_color);
        const hoverColor = adjustColor(settings.accent_color, -20);
        document.documentElement.style.setProperty('--accent-hover', hoverColor);
        updateGradientVariables(settings.accent_color);

        if (settings.language !== currentLanguage) {
            currentLanguage = settings.language;
            await loadTranslations(currentLanguage);
            applyTranslations();
            initCustomSelects();
        }

        zoomEnabled = settings.zoom_enabled;
        zoomFactor = settings.zoom_factor;

        updateQRCode();
    }

    refreshSettingsUI();

    async function saveAllSettings() {
        const lang = languageSelect.value;
        const color = colorPicker.value;
        const wd = workingDirInput ? workingDirInput.value : '';
        const zoomEnabledVal = zoomEnabledCheck ? zoomEnabledCheck.checked : true;
        const zoomFactorVal = zoomFactorInput ? parseFloat(zoomFactorInput.value) || 2 : 2;
        let serverHost = serverHostInput ? serverHostInput.value.trim() : '';
        let serverPort = serverPortInput ? serverPortInput.value.trim() : '';
        const batchSize = batchSizeInput ? parseInt(batchSizeInput.value, 10) || 8 : 8;

        if (serverHost && !isValidIP(serverHost)) {
            alert(t('invalid_ip') || 'Введите корректный IP-адрес (например, 127.0.0.1, 0.0.0.0, localhost)');
            return;
        }
        if (serverPort) {
            const portNum = parseInt(serverPort, 10);
            if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
                alert(t('invalid_port') || 'Порт должен быть числом от 1 до 65535');
                return;
            }
            serverPort = portNum.toString();
        }

        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                language: lang,
                accent_color: color,
                working_directory: wd,
                zoom_enabled: zoomEnabledVal,
                zoom_factor: zoomFactorVal,
                server_host: serverHost,
                server_port: serverPort,
                batch_size: batchSize
            })
        });

        await refreshSettingsUI();
    }

    languageSelect.addEventListener('change', saveAllSettings);
    colorPicker.addEventListener('input', (e) => {
        const newColor = e.target.value;
        document.documentElement.style.setProperty('--accent-color', newColor);
        const hoverColor = adjustColor(newColor, -20);
        document.documentElement.style.setProperty('--accent-hover', hoverColor);
        updateGradientVariables(newColor);
    });
    colorPicker.addEventListener('change', saveAllSettings);
    if (workingDirInput) workingDirInput.addEventListener('change', saveAllSettings);
    if (zoomEnabledCheck && zoomFactorInput) {
        zoomEnabledCheck.addEventListener('change', saveAllSettings);
        zoomFactorInput.addEventListener('input', saveAllSettings);
    }
    if (serverHostInput) serverHostInput.addEventListener('change', saveAllSettings);
    if (serverPortInput) serverPortInput.addEventListener('change', saveAllSettings);
    if (batchSizeInput) batchSizeInput.addEventListener('change', saveAllSettings);

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

    fetch('/api/analyze/status')
        .then(res => res.json())
        .then(status => {
            if (status.running) {
                analyzeActive = true;
                startAnalyzePolling();
                updateAnalyzeProgress(status);
                updateAnalyzeButtons();
            }
        });
})();
