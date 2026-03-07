window.widgetData = [];
window.widgetCharts = new Map();
window.dragState = {
    active: false,
    widgetId: null,
    mode: null,
    startX: 0,
    startY: 0,
    startCol: 0,
    startRow: 0,
    offsetX: 0,
    offsetY: 0,
    originalW: 0,
    originalH: 0,
    placeholder: null,
    newCol: null,
    newRow: null,
    newW: null,
    newH: null,
    originalLeft: 0,
    originalTop: 0,
    originalWidthPx: 0,
    originalHeightPx: 0
};

window.GRID_COLS = 24;
window.GAP = 10;
window.MIN_W = 4;
window.MIN_H = 3;

function initCustomSelects() {
    document.querySelectorAll('select.custom-select:not([data-customized])').forEach(select => {
        select.setAttribute('data-customized', 'true');

        const container = document.createElement('div');
        container.className = 'custom-select-container';

        const selectedDiv = document.createElement('div');
        selectedDiv.className = 'custom-select-selected';
        selectedDiv.textContent = select.options[select.selectedIndex]?.textContent || '';

        const optionsDiv = document.createElement('div');
        optionsDiv.className = 'custom-select-options';

        Array.from(select.options).forEach(option => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'custom-select-option';
            if (option.selected) optionDiv.classList.add('selected');
            optionDiv.textContent = option.textContent;
            optionDiv.dataset.value = option.value;

            optionDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                select.value = option.value;
                optionsDiv.querySelectorAll('.custom-select-option').forEach(opt => opt.classList.remove('selected'));
                optionDiv.classList.add('selected');
                selectedDiv.textContent = option.textContent;
                container.classList.remove('open');
                select.dispatchEvent(new Event('change', { bubbles: true }));
            });

            optionsDiv.appendChild(optionDiv);
        });

        container.appendChild(selectedDiv);
        container.appendChild(optionsDiv);

        select.parentNode.insertBefore(container, select.nextSibling);
        select.style.display = 'none';

        selectedDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.custom-select-container.open').forEach(c => {
                if (c !== container) c.classList.remove('open');
            });
            container.classList.toggle('open');
        });

        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) {
                container.classList.remove('open');
            }
        });

        select.addEventListener('change', () => {
            const selectedOption = select.options[select.selectedIndex];
            selectedDiv.textContent = selectedOption?.textContent || '';
            optionsDiv.querySelectorAll('.custom-select-option').forEach(opt => {
                opt.classList.toggle('selected', opt.dataset.value === select.value);
            });
        });
    });
}

document.addEventListener('DOMContentLoaded', initCustomSelects);

function refreshCustomSelect(selector) {
    const select = document.querySelector(selector);
    if (!select) return;

    const container = select.parentElement?.querySelector('.custom-select-container');
    if (container) container.remove();

    select.removeAttribute('data-customized');

    initCustomSelects();
}

function getGridCellRect(x, y, w, h) {
    const grid = document.getElementById('widgetGrid');
    const totalGapWidth = (GRID_COLS - 1) * GAP;
    const colWidth = (grid.clientWidth - totalGapWidth) / GRID_COLS;
    const rowHeight = colWidth;
    const left = x * (colWidth + GAP) + grid.offsetLeft;
    const top = y * (rowHeight + GAP) + grid.offsetTop;
    const width = w * colWidth + (w - 1) * GAP;
    const height = h * rowHeight + (h - 1) * GAP;
    return { left, top, width, height };
}

function getStatsLayoutClass(width, height) {
    if (width > 500) {
        return 'stats-layout-horizontal';
    }
    if (height > 300 && height > width) {
        return 'stats-layout-vertical';
    }

    return 'stats-layout-grid';
}

function updateGridRowHeight() {
    const grid = document.getElementById('widgetGrid');
    if (!grid) return;
    const totalGapWidth = (GRID_COLS - 1) * GAP;
    const colWidth = (grid.clientWidth - totalGapWidth) / GRID_COLS;
    grid.style.setProperty('--row-height', colWidth + 'px');
}

function showGridOverlay() {
    let overlay = document.querySelector('.grid-overlay');
    if (overlay) return;
    const grid = document.getElementById('widgetGrid');
    overlay = document.createElement('div');
    overlay.className = 'grid-overlay';
    for (let i = 0; i < 30 * 24; i++) {
        const cell = document.createElement('div');
        cell.className = 'grid-overlay-line';
        overlay.appendChild(cell);
    }
    grid.style.position = 'relative';
    grid.appendChild(overlay);
}

function hideGridOverlay() {
    const overlay = document.querySelector('.grid-overlay');
    if (overlay) overlay.remove();
}

function isPositionFree(x, y, w, h, excludeId) {
    if (x < 0 || y < 0 || x + w > GRID_COLS) return false;

    const newCells = [];
    for (let col = x; col < x + w; col++) {
        for (let row = y; row < y + h; row++) {
            newCells.push(`${col},${row}`);
        }
    }

    const occupiedCells = new Set();
    widgetData.forEach(w => {
        if (w.id === excludeId) return;
        for (let col = w.x; col < w.x + w.w; col++) {
            for (let row = w.y; row < w.y + w.h; row++) {
                occupiedCells.add(`${col},${row}`);
            }
        }
    });

    for (let cell of newCells) {
        if (occupiedCells.has(cell)) return false;
    }
    return true;
}

function startDrag(e) {
    e.preventDefault();
    showGridOverlay();
    const header = e.currentTarget;
    const widget = header.closest('.widget-item');
    if (!widget) return;

    const id = widget.id;
    const widgetObj = widgetData.find(w => w.id === id);
    if (!widgetObj) return;

    const rect = widget.getBoundingClientRect();
    const gridRect = document.getElementById('widgetGrid').getBoundingClientRect();

    dragState.active = true;
    dragState.mode = 'move';
    dragState.widgetId = id;
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    dragState.startCol = widgetObj.x;
    dragState.startRow = widgetObj.y;
    dragState.originalLeft = rect.left - gridRect.left;
    dragState.originalTop = rect.top - gridRect.top;
    dragState.offsetX = e.clientX - rect.left;
    dragState.offsetY = e.clientY - rect.top;

    widget.classList.add('dragging');
    widget.style.transformOrigin = 'top left';
    widget.style.transform = 'translate(0, 0)';

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e) {
    if (!dragState.active || dragState.mode !== 'move') return;

    const widget = document.getElementById(dragState.widgetId);
    if (!widget) return;

    const deltaX = e.clientX - dragState.startX;
    const deltaY = e.clientY - dragState.startY;
    widget.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

    const grid = document.getElementById('widgetGrid');
    const totalGapWidth = (GRID_COLS - 1) * GAP;
    const colWidth = (grid.clientWidth - totalGapWidth) / GRID_COLS;
    const rowHeight = colWidth;
    const stepX = colWidth + GAP;
    const stepY = rowHeight + GAP;

    const currentLeft = dragState.originalLeft + deltaX;
    const currentTop = dragState.originalTop + deltaY;

    let newCol = Math.round(currentLeft / stepX);
    let newRow = Math.round(currentTop / stepY);

    const widgetObj = widgetData.find(w => w.id === dragState.widgetId);
    if (!widgetObj) return;

    newCol = Math.max(0, Math.min(GRID_COLS - widgetObj.w, newCol));
    newRow = Math.max(0, newRow);

    if (isPositionFree(newCol, newRow, widgetObj.w, widgetObj.h, widgetObj.id)) {
        dragState.newCol = newCol;
        dragState.newRow = newRow;
    } else {
        dragState.newCol = null;
        dragState.newRow = null;
    }
}

function onDragEnd(e) {
    if (!dragState.active) return;

    const widget = document.getElementById(dragState.widgetId);
    const widgetObj = widgetData.find(w => w.id === dragState.widgetId);

    if (dragState.mode === 'move') {
        if (widget) {
            widget.classList.remove('dragging');
            widget.style.transform = '';
        }
        if (dragState.newCol !== null && dragState.newRow !== null && widgetObj) {
            widgetObj.x = dragState.newCol;
            widgetObj.y = dragState.newRow;
            if (widget) {
                widget.style.gridColumn = `${widgetObj.x + 1} / span ${widgetObj.w}`;
                widget.style.gridRow = `${widgetObj.y + 1} / span ${widgetObj.h}`;
            }
            saveGlobalWidgetLayout(widgetData);
        }
    } else if (dragState.mode === 'resize') {
        if (widget) {
            widget.classList.remove('resizing');
            widget.style.position = '';
            widget.style.left = '';
            widget.style.top = '';
            widget.style.width = '';
            widget.style.height = '';
            widget.style.zIndex = '';
        }
        if (dragState.placeholder) dragState.placeholder.remove();

        if (dragState.newW !== null && dragState.newH !== null && widgetObj) {
            widgetObj.w = dragState.newW;
            widgetObj.h = dragState.newH;
            if (widget) {
                widget.style.gridColumn = `${widgetObj.x + 1} / span ${widgetObj.w}`;
                widget.style.gridRow = `${widgetObj.y + 1} / span ${widgetObj.h}`;
            }
            saveGlobalWidgetLayout(widgetData);
        } else {
            if (widget && widgetObj) {
                widget.style.gridColumn = `${widgetObj.x + 1} / span ${widgetObj.w}`;
                widget.style.gridRow = `${widgetObj.y + 1} / span ${widgetObj.h}`;
            }
        }
    }
    if (widgetObj && widgetObj.type === 'stats') {
        updateWidgetStats(widgetObj.id);
    }


    dragState.active = false;
    hideGridOverlay();
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
}

function startResize(e) {
    e.preventDefault();
    const handle = e.currentTarget;
    const widget = handle.closest('.widget-item');
    if (!widget) return;

    const id = widget.id;
    const widgetObj = widgetData.find(w => w.id === id);
    if (!widgetObj) return;

    const grid = document.getElementById('widgetGrid');
    const gridRect = grid.getBoundingClientRect();
    const widgetRect = widget.getBoundingClientRect();

    const placeholder = document.createElement('div');
    placeholder.className = 'widget-placeholder';
    placeholder.style.gridColumn = `${widgetObj.x + 1} / span ${widgetObj.w}`;
    placeholder.style.gridRow = `${widgetObj.y + 1} / span ${widgetObj.h}`;
    grid.insertBefore(placeholder, widget);

    dragState.active = true;
    dragState.mode = 'resize';
    dragState.widgetId = id;
    dragState.placeholder = placeholder;
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    dragState.startCol = widgetObj.x;
    dragState.startRow = widgetObj.y;
    dragState.originalW = widgetObj.w;
    dragState.originalH = widgetObj.h;
    dragState.originalWidthPx = widgetRect.width;
    dragState.originalHeightPx = widgetRect.height;

    const leftRelative = widgetRect.left - gridRect.left;
    const topRelative = widgetRect.top - gridRect.top;

    widget.style.position = 'absolute';
    widget.style.left = leftRelative + 'px';
    widget.style.top = topRelative + 'px';
    widget.style.width = widgetRect.width + 'px';
    widget.style.height = widgetRect.height + 'px';
    widget.style.gridColumn = '';
    widget.style.gridRow = '';
    widget.style.zIndex = '1000';
    widget.classList.add('resizing');

    showGridOverlay();

    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onDragEnd);
}

function onResizeMove(e) {
    if (!dragState.active || dragState.mode !== 'resize') return;

    const widget = document.getElementById(dragState.widgetId);
    if (!widget) return;

    const deltaX = e.clientX - dragState.startX;
    const deltaY = e.clientY - dragState.startY;

    let newWidthPx = dragState.originalWidthPx + deltaX;
    let newHeightPx = dragState.originalHeightPx + deltaY;

    const grid = document.getElementById('widgetGrid');
    const totalGapWidth = (GRID_COLS - 1) * GAP;
    const colWidth = (grid.clientWidth - totalGapWidth) / GRID_COLS;
    const rowHeight = colWidth;
    const stepX = colWidth + GAP;
    const stepY = rowHeight + GAP;

    const minWidthPx = MIN_W * colWidth + (MIN_W - 1) * GAP;
    const minHeightPx = MIN_H * rowHeight + (MIN_H - 1) * GAP;
    newWidthPx = Math.max(minWidthPx, newWidthPx);
    newHeightPx = Math.max(minHeightPx, newHeightPx);

    widget.style.width = newWidthPx + 'px';
    widget.style.height = newHeightPx + 'px';

    let newW = Math.round((newWidthPx + GAP) / stepX);
    let newH = Math.round((newHeightPx + GAP) / stepY);

    const widgetObj = widgetData.find(w => w.id === dragState.widgetId);
    if (!widgetObj) return;

    newW = Math.max(MIN_W, Math.min(GRID_COLS - widgetObj.x, newW));
    newH = Math.max(MIN_H, newH);

    if (isPositionFree(widgetObj.x, widgetObj.y, newW, newH, widgetObj.id)) {
        dragState.newW = newW;
        dragState.newH = newH;
    } else {
        dragState.newW = null;
        dragState.newH = null;
    }
}

function makeWidgetsDraggable() {
    document.querySelectorAll('.widget-header').forEach(header => {
        header.removeEventListener('mousedown', startDrag);
        header.addEventListener('mousedown', startDrag);
    });
}

function makeWidgetsResizable() {
    document.querySelectorAll('.resize-handle').forEach(handle => {
        handle.removeEventListener('mousedown', startResize);
        handle.addEventListener('mousedown', startResize);
    });
}

function createWidgetElement(widget, index) {
    const div = document.createElement('div');
    div.className = 'widget-item';
    div.id = widget.id;
    div.dataset.index = index;
    div.dataset.widgetType = widget.type;
    div.dataset.widgetOptions = JSON.stringify(widget.options);

    div.style.gridColumn = `${widget.x + 1} / span ${widget.w}`;
    div.style.gridRow = `${widget.y + 1} / span ${widget.h}`;

    div.innerHTML = `
        <div class="widget-header">
            <span class="widget-title">${widget.options.title || getDefaultTitle(widget.type)}</span>
            <div class="widget-controls">
                <button class="widget-close" data-id="${widget.id}">✕</button>
            </div>
        </div>
        <div class="widget-content"></div>
        <div class="resize-handle"></div>
    `;

    div.querySelector('.widget-close').addEventListener('click', (e) => {
        e.stopPropagation();
        const id = e.target.dataset.id;
        removeWidget(id);
    });

    return div;
}

function renderWidgets() {
    widgetCharts.forEach(chart => chart.destroy());
    widgetCharts.clear();

    const grid = document.getElementById('widgetGrid');
    if (!grid) return;
    grid.innerHTML = '';

    widgetData.forEach((widget, index) => {
        const el = createWidgetElement(widget, index);
        grid.appendChild(el);
        renderWidgetContent(el.querySelector('.widget-content'), widget.type, widget.options);
    });

    makeWidgetsDraggable();
    makeWidgetsResizable();
}

function renderWidgetContent(container, type, options) {
    console.log('renderWidgetContent', type, analysisData);
    container.innerHTML = '';
    if (!analysisData) {
        container.innerHTML = `<p style="color: #888;">${t('no_data')}</p>`;
        return;
    }

    let chart = null;

    switch (type) {
        case 'sfwNsfw':
            chart = renderRatingChart(container);
            break;
        case 'topTags':
            chart = renderTopTagsChart(container, options.limit || 10);
            break;
        case 'resolution':
            chart = renderResolutionChart(container);
            break;
        case 'tagHistogram':
            container.innerHTML = `<p style="color: #888;">${t('tag_histogram_placeholder')}</p>`;
            break;
        case 'stats':
            renderStats(container);
            break;
        default:
            container.innerHTML = `<p>${t('unknown_widget')}</p>`;
    }

    if (chart) {
        const widgetEl = container.closest('.widget-item');
        if (widgetEl) {
            widgetCharts.set(widgetEl.id, chart);
        }
    }
}

function renderRatingChart(container) {
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const ratings = analysisData.ratings || { general:0, sensitive:0, questionable:0, explicit:0 };
    const chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['General (PG)', 'Sensitive (PG-13)', 'Questionable (R)', 'Explicit (XXX)'],
            datasets: [{
                data: [ratings.general, ratings.sensitive, ratings.questionable, ratings.explicit],
                backgroundColor: ['#10b981', '#14b8a6', '#8b5cf6', '#ef4444'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#e0e0e0' } }
            }
        }
    });
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    return chart;
}

function renderTopTagsChart(container, limit = 10) {
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const topTags = analysisData.top_tags.slice(0, limit);
    const chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: topTags.map(t => t.tag),
            datasets: [{
                label: t('frequency'),
                data: topTags.map(t => t.count),
                backgroundColor: '#f59e0b'
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { ticks: { color: '#a0a0a0' } },
                y: { ticks: { color: '#a0a0a0' } }
            }
        }
    });
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    return chart;
}

function renderResolutionChart(container) {
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const resolutions = analysisData.resolutions.slice(0, 10);
    const chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: resolutions.map(r => r.resolution),
            datasets: [{
                label: t('count'),
                data: resolutions.map(r => r.count),
                backgroundColor: '#3b82f6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { ticks: { color: '#a0a0a0' } },
                x: { ticks: { color: '#a0a0a0', maxRotation: 45 } }
            }
        }
    });
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    return chart;
}

function getSmileySVG(type, color) {
    const eyes = `
        <circle cx="8" cy="10" r="2" stroke="${color}" fill="none" stroke-width="2"/>
        <circle cx="16" cy="10" r="2" stroke="${color}" fill="none" stroke-width="2"/>
    `;
    let mouth = '';
    switch(type) {
        case 'sad':
            mouth = '<path d="M6 20 Q12 14 18 20" stroke="' + color + '" fill="none" stroke-width="2"/>';
            break;
        case 'neutral':
            mouth = '<path d="M6 16 L18 16" stroke="' + color + '" fill="none" stroke-width="2"/>';
            break;
        case 'happy':
            mouth = '<path d="M6 16 Q12 22 18 16" stroke="' + color + '" fill="none" stroke-width="2"/>';
            break;
        case 'very-happy':
            mouth = '<path d="M6 14 Q12 24 18 14" stroke="' + color + '" fill="none" stroke-width="2"/>';
            break;
        default:
            mouth = '';
    }
    return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${eyes}${mouth}</svg>`;
}

function renderStats(container) {
    if (!analysisData) return;

    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const layoutClass = getStatsLayoutClass(width, height);

    const totalImages = analysisData.total_images;
    const uniqueTags = analysisData.unique_tags;
    const avgTags = analysisData.avg_tags_per_image;
    const predominantAspect = analysisData.predominant_aspect;
    const goodCount = analysisData.good_for_training_count;
    const goodPercent = analysisData.good_for_training_percent;

    let smileyType, smileyColor;
    if (goodPercent < 40) {
        smileyType = 'sad';
        smileyColor = '#ef4444';
    } else if (goodPercent < 70) {
        smileyType = 'neutral';
        smileyColor = '#f59e0b';
    } else if (goodPercent < 90) {
        smileyType = 'happy';
        smileyColor = '#3b82f6';
    } else {
        smileyType = 'very-happy';
        smileyColor = '#10b981';
    }

    const smileySVG = getSmileySVG(smileyType, smileyColor);

    let html = `<div class="stats-grid ${layoutClass}">`;

    html += `
        <div class="stat-item">
            <div class="stat-value">${totalImages}</div>
            <div class="stat-label">${t('total_images')}</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${uniqueTags}</div>
            <div class="stat-label">${t('unique_tags')}</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${avgTags}</div>
            <div class="stat-label">${t('avg_tags_per_image')}</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${predominantAspect}</div>
            <div class="stat-label">${t('predominant_aspect')}</div>
        </div>
    `;

    const smileyClass = layoutClass === 'stats-layout-grid' ? 'full-width' : '';
    html += `
        <div class="stat-item ${smileyClass}">
            <div class="stat-value" style="font-size: 32px; line-height: 1;">${smileySVG}</div>
            <div class="stat-label">${goodCount}/${totalImages} (${goodPercent}%)</div>
            <div class="stat-label">${t('compatible')}</div>
        </div>
    `;

    html += '</div>';
    container.innerHTML = html;
}

function updateWidgetStats(widgetId) {
    const widgetEl = document.getElementById(widgetId);
    if (!widgetEl) return;
    const contentDiv = widgetEl.querySelector('.widget-content');
    const widget = widgetData.find(w => w.id === widgetId);
    if (!widget || widget.type !== 'stats') return;

    contentDiv.innerHTML = '';
    renderWidgetContent(contentDiv, widget.type, widget.options);
}

function getDefaultTitle(type) {
    const titles = {
        sfwNsfw: t('widget_title_sfw_nsfw'),
        topTags: t('widget_title_top_tags'),
        resolution: t('widget_title_resolution'),
        tagHistogram: t('widget_title_tag_histogram'),
        stats: t('widget_title_stats')
    };
    return titles[type] || 'Widget';
}

function addWidget(type, options = {}) {
    const id = `widget_${Date.now()}_${Math.random()}`;
    const maxY = widgetData.reduce((max, w) => Math.max(max, w.y + w.h), 0);
    const widget = {
        id,
        type,
        options: { ...options, title: options.title || getDefaultTitle(type) },
        x: 0,
        y: maxY,
        w: 8,
        h: 4
    };
    widgetData.push(widget);
    renderWidgets();
    saveGlobalWidgetLayout(widgetData);
}

function removeWidget(id) {
    if (widgetCharts.has(id)) {
        widgetCharts.get(id).destroy();
        widgetCharts.delete(id);
    }
    widgetData = widgetData.filter(w => w.id !== id);
    renderWidgets();
    saveGlobalWidgetLayout(widgetData);
}

function createDefaultLayout() {
    widgetData = [
        { id: 'widget_sfw', type: 'sfwNsfw', options: { title: t('widget_title_sfw_nsfw') }, x: 0, y: 0, w: 8, h: 4 },
        { id: 'widget_top', type: 'topTags', options: { title: t('widget_title_top_tags'), limit: 20 }, x: 8, y: 0, w: 8, h: 4 },
        { id: 'widget_res', type: 'resolution', options: { title: t('widget_title_resolution') }, x: 16, y: 0, w: 8, h: 4 },
    ];
}

async function loadGlobalWidgetLayout() {
    const resp = await fetch('/api/widget-layout');
    const data = await resp.json();
    return data.layout;
}

async function saveGlobalWidgetLayout(layout) {
    await fetch('/api/widget-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout })
    });
}

function openAddWidgetModal() {
    const oldModal = document.getElementById('addWidgetModal');
    if (oldModal) oldModal.remove();

    const addModal = document.createElement('div');
    addModal.id = 'addWidgetModal';
    addModal.className = 'modal';
    addModal.innerHTML = `
        <div class="modal-content modal-small">
            <div class="modal-body">
                <h3 style="margin-bottom: 20px;">${t('add_widget_title')}</h3>
                <div class="form-group">
                    <label for="widgetType">${t('widget_type')}</label>
                    <select id="widgetType" class="custom-select">
                        <option value="sfwNsfw">${t('widget_title_sfw_nsfw')}</option>
                        <option value="topTags">${t('widget_title_top_tags')}</option>
                        <option value="resolution">${t('widget_title_resolution')}</option>
                        <option value="tagHistogram">${t('widget_title_tag_histogram')}</option>
                        <option value="stats">${t('widget_title_stats')}</option>
                    </select>
                </div>
                <div class="form-group" id="widgetParamGroup" style="display: none;">
                    <label for="widgetParam">${t('widget_param')}</label>
                    <input type="number" id="widgetParam" value="10" min="1" max="50">
                </div>
                <div class="form-actions">
                    <button class="btn btn-secondary" id="cancelAddWidget">${t('cancel')}</button>
                    <button class="btn btn-primary" id="confirmAddWidget">${t('add')}</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(addModal);

    initCustomSelects();

    const typeSelect = addModal.querySelector('#widgetType');
    const paramGroup = addModal.querySelector('#widgetParamGroup');
    typeSelect.addEventListener('change', () => {
        paramGroup.style.display = typeSelect.value === 'topTags' ? 'block' : 'none';
    });

    addModal.addEventListener('click', (e) => {
        if (e.target === addModal) closeAddModal();
    });

    document.getElementById('cancelAddWidget').addEventListener('click', closeAddModal);
    document.getElementById('confirmAddWidget').addEventListener('click', () => {
        const type = typeSelect.value;
        const options = { title: typeSelect.options[typeSelect.selectedIndex].text };
        if (type === 'topTags') {
            options.limit = parseInt(document.getElementById('widgetParam').value, 10) || 10;
        }
        addWidget(type, options);
        closeAddModal();
    });

    addModal.classList.add('show');

    function closeAddModal() {
        addModal.classList.remove('show');
        setTimeout(() => {
            if (addModal && addModal.parentNode) addModal.remove();
        }, 300);
    }
}