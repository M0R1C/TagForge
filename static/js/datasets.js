(function() {
    const t = window.t;
    let currentContainer = null;
    let currentDataset = null;
    let currentPath = '';
    let datasetsList = [];
    let flagsList = [];
    let versionsInfo = {};
    let currentVersion = null;

    const imageIconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    const tagIconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';
    const folderIconSvg = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z"/></svg>';

    window.DatasetsTab = {
        init: function(container) {
            currentContainer = container;
            fetch('/api/flags')
                .then(res => res.json())
                .then(flags => {
                    flagsList = flags;
                    this.showDatasetsList();
                })
                .catch(err => {
                    currentContainer.innerHTML = `<div class="error">Ошибка загрузки флагов: ${err}</div>`;
                });
        },

        showDatasetsList: function() {
            fetch('/api/datasets')
                .then(res => res.json())
                .then(data => {
                    if (data.error) {
                        currentContainer.innerHTML = `<div class="error">${data.error}</div>`;
                        return;
                    }
                    datasetsList = data;
                    renderDatasetsList(data);
                })
                .catch(err => {
                    currentContainer.innerHTML = `<div class="error">Ошибка загрузки: ${err}</div>`;
                });
        },

        openDataset: function(datasetName) {
            currentDataset = datasetName;
            currentPath = '';
            fetch(`/api/datasets/${encodeURIComponent(datasetName)}/versions`)
                .then(res => res.json())
                .then(versions => {
                    versionsInfo = versions;
                    const versionNames = Object.keys(versionsInfo).sort((a, b) => versionCompare(b, a));
                    currentVersion = versionNames.length > 0 ? versionNames[0] : null;
                    if (currentVersion) {
                        currentPath = currentVersion;
                    }
                    this.browse();
                })
                .catch(err => {
                    alert('Ошибка загрузки данных: ' + err);
                });
        },

        browse: function() {
            fetch(`/api/datasets/${encodeURIComponent(currentDataset)}/browse?path=${encodeURIComponent(currentPath)}`)
                .then(res => res.json())
                .then(data => {
                    if (data.error) {
                        alert(data.error);
                        return;
                    }
                    renderDatasetBrowser(data);
                })
                .catch(err => alert('Ошибка: ' + err));
        },

        backToDatasets: function() {
            currentDataset = null;
            currentPath = '';
            currentVersion = null;
            this.showDatasetsList();
        },

        refresh: function() {
            if (currentDataset) {
                this.browse();
            } else {
                this.showDatasetsList();
            }
        }
    };

    function getColumnCount(containerWidth) {
        const minWidth = 180;
        const gap = 16;
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

    function setupModalClosure(modal, onCloseCallback) {
        const closeModal = () => {
            if (modal && modal.parentNode) {
                modal.remove();
                document.removeEventListener('keydown', keyHandler);
                if (onCloseCallback) onCloseCallback();
            }
        };
        const keyHandler = (e) => {
            if (e.key === 'Escape') closeModal();
        };
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        document.addEventListener('keydown', keyHandler);
        return closeModal;
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function versionCompare(a, b) {
        const aParts = a.replace('v', '').split('_').map(Number);
        const bParts = b.replace('v', '').split('_').map(Number);
        if (aParts[0] !== bParts[0]) return aParts[0] - bParts[0];
        return aParts[1] - bParts[1];
    }

    function getFlagColor(flagName) {
        const flag = flagsList.find(f => f.name === flagName);
        return flag ? flag.color : '#3b82f6';
    }

    function renderDatasetsList(datasets) {
        const html = `
            <div class="datasets-header">
                <h2 data-i18n="datasets">${t('datasets')}</h2>
                <div class="datasets-search">
                    <input type="text" id="datasetSearch" data-i18n-placeholder="search" placeholder="${t('search')}">
                </div>
            </div>
            <div class="datasets-grid" id="datasetsGrid"></div>
        `;
        currentContainer.innerHTML = html;
        const grid = document.getElementById('datasetsGrid');


        datasets.forEach(ds => {
            const card = document.createElement('div');
            card.className = 'dataset-card';
            card.dataset.name = ds.name;

            let coverHtml = `<div class="dataset-cover-placeholder">${folderIconSvg}</div>`;
            if (ds.cover) {
                coverHtml = `<img src="/api/datasets/${encodeURIComponent(ds.name)}/image/${encodeURIComponent(ds.cover)}" class="dataset-cover">`;
            }

            const flagsContainerId = `flags-${Date.now()}-${Math.random()}`;

            card.innerHTML = `
                ${coverHtml}
                <div class="dataset-info">
                    <div class="dataset-header">
                        <h3 class="dataset-title" title="${escapeHtml(ds.name)}">${escapeHtml(ds.name)}</h3>
                        <span class="dataset-image-count">
                            <span class="icon">${imageIconSvg}</span> ${ds.image_count}
                        </span>
                    </div>
                    <div class="dataset-version">
                        <span class="icon">${tagIconSvg}</span> ${ds.last_version ? ds.last_version.replace('_', '.') : '—'}
                    </div>
                    <div class="dataset-flags" id="${flagsContainerId}"></div>
                </div>
                <button class="dataset-delete-btn" data-name="${escapeHtml(ds.name)}" title="${t('delete_dataset')}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
                <button class="dataset-edit-btn" data-name="${escapeHtml(ds.name)}" title="${t('edit')}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                    </svg>
                </button>
            `;
            card.addEventListener('click', (e) => {
                if (e.target.closest('.dataset-edit-btn')) return;
                window.DatasetsTab.openDataset(ds.name);
            });
            card.querySelector('.dataset-edit-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                showEditDatasetModal(ds.name);
            });

            card.querySelector('.dataset-delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                showDeleteDatasetConfirm(ds.name);
            });
            grid.appendChild(card);

            if (ds.last_version) {
                fetch(`/api/datasets/${encodeURIComponent(ds.name)}/versions`)
                    .then(res => res.json())
                    .then(versions => {
                        const flags = versions[ds.last_version]?.flags || [];
                        if (flags.length > 0) {
                            const container = document.getElementById(flagsContainerId);
                            if (container) {
                                container.innerHTML = renderFlagBadges(flags);
                            }
                        }
                    })
                    .catch(err => console.warn('Не удалось загрузить флаги для', ds.name, err));
            }
        });

        const addCard = document.createElement('div');
        addCard.className = 'dataset-card add-card';
        addCard.innerHTML = `
            <div class="add-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 5v14M5 12h14"/>
                </svg>
            </div>
            <p>${t('create_dataset')}</p>
        `;
        addCard.addEventListener('click', showCreateDatasetModal);
        grid.appendChild(addCard);

        document.getElementById('datasetSearch')?.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            document.querySelectorAll('.dataset-card:not(.add-card)').forEach(card => {
                const name = card.querySelector('h3').textContent.toLowerCase();
                card.style.display = name.includes(query) ? '' : 'none';
            });
        });
    }

    function renderDatasetBrowser(data) {
        const html = `
            <div class="browser-header">
                <div class="browser-header-left">
                    <button class="btn-icon" id="browserBackBtn" title="${t('back_to_list')}" data-i18n-title="back_to_list">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M19 12H5M12 19l-7-7 7-7"/>
                        </svg>
                    </button>
                    <div class="browser-search">
                        <input type="text" id="browserSearch" data-i18n-placeholder="search_files" placeholder="${t('search_files')}">
                    </div>
                    <button class="btn-icon" id="uploadBtn" title="${t('upload_files')}" data-i18n-title="upload_files">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    </button>
                    <button class="btn-icon" id="exportDatasetBtn" title="${t('open_in_editor')}" data-i18n-title="open_in_editor">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                    </button>
                </div>
                <div class="browser-header-right">
                    <div class="version-selector" id="versionSelector"></div>
                    <button class="btn-icon" id="newVersionBtn" title="${t('create_version')}" data-i18n-title="create_version">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="12" y1="12" x2="12" y2="18"/></svg>
                    </button>
                    <button class="btn-icon" id="manageFlagsBtn" title="${t('manage_flags')}" data-i18n-title="manage_flags">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                    </button>
                </div>
            </div>
            <div class="browser-main">
                <div class="browser-grid" id="browserGrid"></div>
                <div class="browser-drop-overlay">
                    <div class="drop-overlay-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        <span>${t('drop_files_here')}</span>
                    </div>
                </div>
            </div>
        `;
        currentContainer.innerHTML = html;

        renderVersionSelector();
        document.getElementById('browserBackBtn').addEventListener('click', () => {
            window.DatasetsTab.backToDatasets();
        });
        document.getElementById('manageFlagsBtn').addEventListener('click', showManageFlagsModal);
        document.getElementById('uploadBtn').addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.webkitdirectory = true;
            input.addEventListener('change', (e) => {
                const files = Array.from(e.target.files);
                uploadFiles(files);
            });
            input.click();
        });
        document.getElementById('exportDatasetBtn').addEventListener('click', () => {
            fetch(`/api/datasets/${encodeURIComponent(currentDataset)}/fullpath?path=${encodeURIComponent(currentPath)}`)
                .then(res => res.json())
                .then(data => {
                    if (data.error) {
                        alert(data.error);
                        return;
                    }
                    const pathInput = document.getElementById('datasetPath');
                    const loadButton = document.getElementById('loadDatasetBtn');
                    if (pathInput && loadButton) {
                        pathInput.value = data.path;
                        loadButton.click();
                        const pointTab = document.querySelector('.tab-button[data-tab="point"]');
                        if (pointTab) pointTab.click();
                    }
                })
                .catch(err => alert('Ошибка: ' + err));
        });

        document.getElementById('newVersionBtn').addEventListener('click', showCreateVersionModal);

        const grid = document.getElementById('browserGrid');
        const scrollContainer = document.getElementById('mainContent');
        grid._allItems = data.items;
        renderBrowserItems(data.items, grid, scrollContainer);

        grid.addEventListener('click', (e) => {
            const itemDiv = e.target.closest('.browser-item');
            if (!itemDiv) return;

            const name = itemDiv.dataset.name;
            const isDirectory = itemDiv.classList.contains('directory');

            if (e.target.closest('.item-rename')) {
                e.stopPropagation();
                showRenameModal(name, isDirectory);
                return;
            }
            if (e.target.closest('.item-delete')) {
                e.stopPropagation();
                if (sessionStorage.getItem('dontAskDeleteItem') === 'true') {
                    deleteItem(name, null);
                } else {
                    showDeleteConfirmModal(name);
                }
                return;
            }
            if (isDirectory) {
                currentPath = currentPath ? currentPath + '/' + name : name;
                window.DatasetsTab.browse();
            } else if (itemDiv.classList.contains('image')) {
                const imgPath = `/api/datasets/${encodeURIComponent(currentDataset)}/image/${encodeURIComponent(currentPath ? currentPath + '/' + name : name)}`;
                openImagePreview(imgPath, name);
            }
        });

        const searchInput = document.getElementById('browserSearch');
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.toLowerCase();
            const filtered = grid._allItems.filter(item => item.name.toLowerCase().includes(query));
            renderBrowserItems(filtered, grid, scrollContainer);
        });

        setupDragAndDrop();
    }

    function renderVersionSelector() {
        const container = document.getElementById('versionSelector');
        if (!container) return;
        const versionNames = Object.keys(versionsInfo).sort(versionCompare).reverse();
        if (versionNames.length === 0) {
            container.innerHTML = `<span class="no-versions" data-i18n="no_versions">${t('no_versions')}</span>`;
            return;
        }
        if (!currentVersion || !versionsInfo[currentVersion]) {
            currentVersion = versionNames[0];
        }

        const selector = document.createElement('div');
        selector.className = 'custom-select-container version-select';
        selector.setAttribute('data-selected', currentVersion);

        const selectedDiv = document.createElement('div');
        selectedDiv.className = 'custom-select-selected';
        selectedDiv.innerHTML = `${currentVersion.replace('_', '.')} <span class="version-flags">${renderFlagBadges(versionsInfo[currentVersion].flags)}</span>`;

        const optionsDiv = document.createElement('div');
        optionsDiv.className = 'custom-select-options';

        versionNames.forEach(ver => {
            const option = document.createElement('div');
            option.className = `custom-select-option ${ver === currentVersion ? 'selected' : ''}`;
            option.dataset.value = ver;
            option.innerHTML = `${ver.replace('_', '.')} ${renderFlagBadges(versionsInfo[ver].flags)}`;
            option.addEventListener('click', () => {
                if (ver === currentVersion) return;
                currentVersion = ver;
                currentPath = ver;
                window.DatasetsTab.browse();
                selector.classList.remove('open');
            });
            optionsDiv.appendChild(option);
        });

        selectedDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            selector.classList.toggle('open');
        });

        selector.appendChild(selectedDiv);
        selector.appendChild(optionsDiv);
        container.innerHTML = '';
        container.appendChild(selector);

        document.addEventListener('click', function closeSelect(e) {
            if (!selector.contains(e.target)) {
                selector.classList.remove('open');
            }
        });
    }

    function renderFlagBadges(flags) {
        if (!flags || flags.length === 0) return '';
        return flags.map(f =>
            `<span class="version-flag" style="border-color: ${getFlagColor(f)};" title="${escapeHtml(f)}">${escapeHtml(f)}</span>`
        ).join('');
    }

    function renderBrowserItems(items, container, scrollContainer) {
        if (container._virtualScrollCleanup) {
            container._virtualScrollCleanup();
        }

        container.innerHTML = '';
        container.style.position = 'relative';
        container.style.height = '1px';

        if (items.length === 0) {
            container.innerHTML = `<p class="empty-folder" data-i18n="empty_folder">${t('empty_folder')}</p>`;
            return;
        }

        const CARD_HEIGHT = 230;
        const GAP = 16;
        const ROW_HEIGHT = CARD_HEIGHT + GAP;
        const BUFFER = 5;

        let visibleItems = new Map();
        let currentRange = { start: 0, end: 0 };
        let lastContainerWidth = container.clientWidth;

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
            const totalRows = Math.ceil(items.length / columns);
            const totalHeight = totalRows * ROW_HEIGHT;
            container.style.height = totalHeight + 'px';

            const firstVisibleRow = Math.floor(scrollTop / ROW_HEIGHT);
            const lastVisibleRow = Math.floor((scrollTop + viewportHeight) / ROW_HEIGHT);

            const startRow = Math.max(0, firstVisibleRow - BUFFER);
            const endRow = Math.min(totalRows - 1, lastVisibleRow + BUFFER);

            const newStart = startRow * columns;
            const newEnd = Math.min(items.length - 1, (endRow + 1) * columns - 1);

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
                const item = items[i];
                const div = createItemElement(item, i, columns, ROW_HEIGHT, GAP, containerWidth);
                container.appendChild(div);
                visibleItems.set(i, div);
            }
        }

        function createItemElement(item, index, columns, rowHeight, gap, containerWidth) {
            const div = document.createElement('div');
            div.className = `browser-item ${item.type}`;
            div.dataset.name = item.name;
            div.dataset.index = index;

            const pos = getItemPosition(index, columns, rowHeight, gap, containerWidth);
            div.style.position = 'absolute';
            div.style.top = pos.top + 'px';
            div.style.left = pos.left;
            div.style.width = pos.width;
            div.style.height = CARD_HEIGHT + 'px';

            let iconHtml = '';
            if (item.type === 'directory') {
                iconHtml = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z"/></svg>`;
            } else if (item.type === 'image') {
                const v = item.mtime ? item.mtime : Date.now();
                const thumbSrc = `/api/datasets/${encodeURIComponent(currentDataset)}/thumbnail/${encodeURIComponent(currentPath ? currentPath + '/' + item.name : item.name)}?v=${v}`;
                const fullSrc = `/api/datasets/${encodeURIComponent(currentDataset)}/image/${encodeURIComponent(currentPath ? currentPath + '/' + item.name : item.name)}`;
                iconHtml = `
                    <div class="item-thumb-container">
                        <img src="${thumbSrc}"
                             data-full-src="${fullSrc}"
                             class="item-thumb"
                             loading="lazy"
                             decoding="async">
                    </div>
                `;
            }

            div.innerHTML = `
                <div class="item-icon">${iconHtml}</div>
                <span class="item-name">${escapeHtml(item.name)}</span>
                <div class="item-actions">
                    <button class="item-rename" title="Переименовать">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                        </svg>
                    </button>
                    <button class="item-delete" title="Удалить">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            `;

            return div;
        }

        const onScroll = () => requestAnimationFrame(updateVisibleRange);
        scrollContainer.addEventListener('scroll', onScroll);

        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(updateVisibleRange);
        });
        resizeObserver.observe(container);

        window.addEventListener('resize', () => {
            requestAnimationFrame(updateVisibleRange);
        });

        container._virtualScrollCleanup = () => {
            scrollContainer.removeEventListener('scroll', onScroll);
            resizeObserver.disconnect();
            window.removeEventListener('resize', updateVisibleRange);
        };

        updateVisibleRange();
    }

    function setupDragAndDrop() {
        const browserMain = document.querySelector('.browser-main');
        const overlay = document.querySelector('.browser-drop-overlay');
        const mainContent = document.querySelector('.main-content');
        if (!browserMain || !overlay) return;

        let dragCounter = 0;

        function blockScroll() {
            if (mainContent && !mainContent.classList.contains('no-scroll')) {
                mainContent.classList.add('no-scroll');
            }
        }

        function unblockScroll() {
            if (mainContent && mainContent.classList.contains('no-scroll')) {
                mainContent.classList.remove('no-scroll');
            }
        }

        function updateOverlayPosition() {
            const rect = browserMain.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;

            const visibleTop = Math.max(rect.top, 0);
            const visibleBottom = Math.min(rect.bottom, viewportHeight);
            const visibleLeft = Math.max(rect.left, 0);
            const visibleRight = Math.min(rect.right, viewportWidth);

            if (visibleTop >= visibleBottom || visibleLeft >= visibleRight) {
                overlay.classList.remove('show');
                unblockScroll();
                return;
            }

            overlay.style.top = visibleTop + 'px';
            overlay.style.left = visibleLeft + 'px';
            overlay.style.width = (visibleRight - visibleLeft) + 'px';
            overlay.style.height = (visibleBottom - visibleTop) + 'px';
        }

        browserMain.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            if (dragCounter === 1) {
                overlay.classList.add('show');
                blockScroll();
                updateOverlayPosition();
            }
        });

        browserMain.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        browserMain.addEventListener('dragleave', (e) => {
            e.preventDefault();
            if (!browserMain.contains(e.relatedTarget)) {
                dragCounter--;
                if (dragCounter === 0) {
                    overlay.classList.remove('show');
                    unblockScroll();
                }
            }
        });

        browserMain.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            overlay.classList.remove('show');
            unblockScroll();
            const items = e.dataTransfer.items;
            handleDrop(items);
        });

        document.addEventListener('dragleave', (e) => {
            if (e.clientX <= 0 && e.clientY <= 0) {
                dragCounter = 0;
                overlay.classList.remove('show');
                unblockScroll();
            }
        });

        window.addEventListener('scroll', () => {
            if (overlay.classList.contains('show')) {
                updateOverlayPosition();
            }
        }, { passive: true });

        window.addEventListener('resize', () => {
            if (overlay.classList.contains('show')) {
                updateOverlayPosition();
            }
        });
    }

    function handleDrop(items) {
        const filePromises = [];
        for (let i = 0; i < items.length; i++) {
            const entry = items[i].webkitGetAsEntry();
            if (entry) {
                filePromises.push(processEntry(entry));
            }
        }
        Promise.all(filePromises).then(filesArray => {
            const allFiles = filesArray.flat();
            uploadFiles(allFiles);
        });
    }

    function processEntry(entry) {
        return new Promise(resolve => {
            if (entry.isFile) {
                entry.file(file => {
                    resolve([file]);
                });
            } else if (entry.isDirectory) {
                const dirReader = entry.createReader();
                const files = [];
                const readAll = () => {
                    dirReader.readEntries(entries => {
                        if (entries.length === 0) {
                            resolve(files);
                        } else {
                            const subPromises = entries.map(processEntry);
                            Promise.all(subPromises).then(subFiles => {
                                files.push(...subFiles.flat());
                                readAll();
                            });
                        }
                    });
                };
                readAll();
            }
        });
    }

    function uploadFiles(files) {
        const formData = new FormData();
        files.forEach(file => {
            formData.append('files', file);
        });
        formData.append('path', currentPath);
        fetch(`/api/datasets/${encodeURIComponent(currentDataset)}/upload`, {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                alert(data.error);
            } else {
                window.DatasetsTab.browse();
            }
        })
        .catch(err => alert('Ошибка: ' + err));
    }

    function showCreateDatasetModal() {
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.classList.add('dataset-modal');
        modal.innerHTML = `
            <div class="modal-content modal-small">
                <div class="modal-body">
                    <h3>${t('create_new_dataset')}</h3>
                    <div class="form-group">
                        <label>${t('dataset_name')}</label>
                        <input type="text" id="newDatasetName" data-i18n-placeholder="dataset_name_placeholder" placeholder="${t('dataset_name_placeholder')}" class="mass-input">
                    </div>
                    <div class="form-group">
                        <label>${t('cover_optional')}</label>
                        <div class="cover-upload-area" id="coverDropZone">
                            <input type="file" id="coverInput" accept="image/jpeg,image/png,image/webp" style="display: none;">
                            <div class="cover-placeholder">
                                <span>+</span>
                                <p>${t('drag_or_click')}</p>
                            </div>
                            <img id="coverPreview" class="cover-preview" style="display: none;">
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" id="cancelCreate">${t('cancel')}</button>
                    <button class="btn-primary" id="confirmCreate">${t('create')}</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const closeModal = setupModalClosure(modal);

        const coverArea = document.getElementById('coverDropZone');
        const coverInput = document.getElementById('coverInput');
        const coverPreview = document.getElementById('coverPreview');
        const placeholder = coverArea.querySelector('.cover-placeholder');

        coverArea.addEventListener('click', () => coverInput.click());
        coverInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    coverPreview.src = e.target.result;
                    coverPreview.style.display = 'block';
                    placeholder.style.display = 'none';
                };
                reader.readAsDataURL(file);
            }
        });
        coverArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            coverArea.classList.add('dragover');
        });
        coverArea.addEventListener('dragleave', () => {
            coverArea.classList.remove('dragover');
        });
        coverArea.addEventListener('drop', (e) => {
            e.preventDefault();
            coverArea.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                coverInput.files = e.dataTransfer.files;
                const reader = new FileReader();
                reader.onload = (e) => {
                    coverPreview.src = e.target.result;
                    coverPreview.style.display = 'block';
                    placeholder.style.display = 'none';
                };
                reader.readAsDataURL(file);
            }
        });

        document.getElementById('cancelCreate').addEventListener('click', closeModal);
        document.getElementById('confirmCreate').addEventListener('click', () => {
            const name = document.getElementById('newDatasetName').value.trim();
            if (!name) return;
            const formData = new FormData();
            formData.append('name', name);
            if (coverInput.files[0]) {
                formData.append('cover', coverInput.files[0]);
            }
            fetch('/api/datasets', {
                method: 'POST',
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    alert(data.error);
                } else {
                    modal.remove();
                    window.DatasetsTab.showDatasetsList();
                }
            })
            .catch(err => alert('Ошибка: ' + err));
        });
    }

    function showCreateVersionModal() {
        fetch('/api/flags')
            .then(res => res.json())
            .then(flags => {
                const versionNames = Object.keys(versionsInfo).sort(versionCompare).reverse();

                const modal = document.createElement('div');
                modal.className = 'modal show';
                modal.classList.add('dataset-modal');
                modal.innerHTML = `
                    <div class="modal-content modal-small">
                        <div class="modal-body">
                            <h3>${t('new_version')}</h3>
                            <div class="form-group">
                                <label>${t('version_format')}</label>
                                <input type="text" id="versionInput" data-i18n-placeholder="version_example" placeholder="${t('version_example')}" class="mass-input">
                            </div>
                            <div class="form-group">
                                <label>${t('base_version')}</label>
                                <div class="custom-select-container" id="baseVersionSelect">
                                    <div class="custom-select-selected" data-selected="">${t('none')}</div>
                                    <div class="custom-select-options">
                                        <div class="custom-select-option" data-value="">${t('none')}</div>
                                        ${versionNames.map(v =>
                                            `<div class="custom-select-option" data-value="${v}">${v.replace('_', '.')}</div>`
                                        ).join('')}
                                    </div>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>${t('flags')}</label>
                                <div class="flags-select" id="flagsSelect"></div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button class="btn-secondary" id="cancelVersion">${t('cancel')}</button>
                            <button class="btn-primary" id="createVersion">${t('create')}</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
                const closeModal = setupModalClosure(modal);

                const baseSelect = document.getElementById('baseVersionSelect');
                const selectedDiv = baseSelect.querySelector('.custom-select-selected');
                const optionsDiv = baseSelect.querySelector('.custom-select-options');

                selectedDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    baseSelect.classList.toggle('open');
                });

                optionsDiv.querySelectorAll('.custom-select-option').forEach(opt => {
                    opt.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const value = opt.dataset.value;
                        const text = opt.textContent;
                        selectedDiv.textContent = text;
                        selectedDiv.dataset.selected = value;
                        baseSelect.classList.remove('open');
                    });
                });

                document.addEventListener('click', (e) => {
                    if (!baseSelect.contains(e.target)) {
                        baseSelect.classList.remove('open');
                    }
                });

                const flagsContainer = document.getElementById('flagsSelect');
                const selectedFlags = new Set();

                flags.forEach(flag => {
                    const flagBtn = document.createElement('span');
                    flagBtn.className = 'version-flag';
                    flagBtn.style.borderColor = flag.color;
                    flagBtn.textContent = flag.name;
                    flagBtn.dataset.name = flag.name;

                    flagBtn.addEventListener('click', () => {
                        if (selectedFlags.has(flag.name)) {
                            selectedFlags.delete(flag.name);
                            flagBtn.classList.remove('selected');
                        } else {
                            if (selectedFlags.size >= 3) {
                                return;
                            }
                            selectedFlags.add(flag.name);
                            flagBtn.classList.add('selected');
                        }
                    });

                    flagsContainer.appendChild(flagBtn);
                });

                document.getElementById('cancelVersion').addEventListener('click', closeModal);
                document.getElementById('createVersion').addEventListener('click', () => {
                    const versionStr = document.getElementById('versionInput').value.trim();
                    if (!versionStr || !/^\d+\.\d+$/.test(versionStr)) {
                        alert('Введите версию в формате X.Y (например, 1.2)');
                        return;
                    }
                    const [major, minor] = versionStr.split('.').map(Number);
                    const selected = Array.from(selectedFlags);
                    const baseVersion = selectedDiv.dataset.selected || '';

                    fetch(`/api/datasets/${encodeURIComponent(currentDataset)}/create_version`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ major, minor, base_version: baseVersion, flags: selected })
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.error) {
                            alert(data.error);
                        } else {
                            modal.remove();
                            fetch(`/api/datasets/${encodeURIComponent(currentDataset)}/versions`)
                                .then(r => r.json())
                                .then(versions => {
                                    versionsInfo = versions;
                                    currentVersion = data.version;
                                    currentPath = data.version;
                                    renderVersionSelector();
                                    window.DatasetsTab.browse();
                                });
                        }
                    })
                    .catch(err => alert('Ошибка: ' + err));
                });
            });
    }

    function showEditDatasetModal(datasetName) {
        fetch(`/api/datasets/${encodeURIComponent(datasetName)}/info`)
            .then(res => res.json())
            .then(info => {
                const modal = document.createElement('div');
                modal.className = 'modal show dataset-modal';
                modal.innerHTML = `
                    <div class="modal-content modal-small">
                        <div class="modal-body">
                            <h3>${t('edit_dataset')}</h3>
                            <div class="form-group">
                                <label>${t('dataset_name')}</label>
                                <input type="text" id="editDatasetName" value="${escapeHtml(info.name)}" class="mass-input">
                            </div>
                            <div class="form-group">
                                <label>${t('cover')}</label>
                                <div class="cover-upload-area" id="editCoverDropZone">
                                    <input type="file" id="editCoverInput" accept="image/jpeg,image/png,image/webp" style="display: none;">
                                    <div class="cover-placeholder" id="editCoverPlaceholder" style="${info.metadata?.cover ? 'display: none;' : ''}">
                                        <span>+</span>
                                        <p>${t('drag_or_click')}</p>
                                    </div>
                                    <img id="editCoverPreview" class="cover-preview" src="${info.metadata?.cover ? `/api/datasets/${encodeURIComponent(datasetName)}/thumbnail/${encodeURIComponent(info.metadata.cover)}` : ''}" style="${info.metadata?.cover ? 'display: block;' : 'display: none;'}">
                                </div>
                                ${info.metadata?.cover ? `<button id="removeCoverBtn" class="btn-secondary" style="margin-top: 8px;">${t('remove_cover')}</button>` : ''}
                            </div>
                            <div class="form-group">
                                <label>${t('versions')}</label>
                                <div class="versions-list" style="max-height: 160px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 16px; padding: 8px;">
                                    ${info.versions.map(ver => `
                                        <div class="version-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid var(--border-color);">
                                            <span>${ver.replace('_', '.')}</span>
                                            <button class="delete-version-btn btn-icon" data-version="${ver}" style="color: #ef4444; width: 32px; height: 32px;">
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                            </button>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button class="btn-secondary" id="cancelEdit">${t('cancel')}</button>
                            <button class="btn-primary" id="saveEdit">${t('save_changes')}</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
                const closeModal = setupModalClosure(modal);

                const coverArea = document.getElementById('editCoverDropZone');
                const coverInput = document.getElementById('editCoverInput');
                const coverPreview = document.getElementById('editCoverPreview');
                const coverPlaceholder = document.getElementById('editCoverPlaceholder');
                const removeCoverBtn = document.getElementById('removeCoverBtn');

                coverArea.addEventListener('click', () => coverInput.click());
                coverInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            coverPreview.src = e.target.result;
                            coverPreview.style.display = 'block';
                            coverPlaceholder.style.display = 'none';
                            if (removeCoverBtn) removeCoverBtn.style.display = 'none';
                        };
                        reader.readAsDataURL(file);
                    }
                });
                coverArea.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    coverArea.classList.add('dragover');
                });
                coverArea.addEventListener('dragleave', () => {
                    coverArea.classList.remove('dragover');
                });
                coverArea.addEventListener('drop', (e) => {
                    e.preventDefault();
                    coverArea.classList.remove('dragover');
                    const file = e.dataTransfer.files[0];
                    if (file && file.type.startsWith('image/')) {
                        coverInput.files = e.dataTransfer.files;
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            coverPreview.src = e.target.result;
                            coverPreview.style.display = 'block';
                            coverPlaceholder.style.display = 'none';
                            if (removeCoverBtn) removeCoverBtn.style.display = 'none';
                        };
                        reader.readAsDataURL(file);
                    }
                });

                if (removeCoverBtn) {
                    removeCoverBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (confirm('Удалить обложку?')) {
                            const resp = await fetch(`/api/datasets/${encodeURIComponent(datasetName)}/cover`, { method: 'DELETE' });
                            const data = await resp.json();
                            if (data.error) {
                                alert(data.error);
                            } else {
                                coverPreview.style.display = 'none';
                                coverPlaceholder.style.display = 'flex';
                                removeCoverBtn.remove();
                            }
                        }
                    });
                }

                document.querySelectorAll('.delete-version-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const version = btn.dataset.version;
                        const resp = await fetch(`/api/datasets/${encodeURIComponent(datasetName)}/version/${encodeURIComponent(version)}`, { method: 'DELETE' });
                        const data = await resp.json();
                        if (data.error) {
                            alert(data.error);
                        } else {
                            btn.closest('.version-item').remove();
                        }
                    });
                });

                document.getElementById('cancelEdit').addEventListener('click', closeModal);
                document.getElementById('saveEdit').addEventListener('click', async () => {
                    const newName = document.getElementById('editDatasetName').value.trim();
                    if (!newName) {
                        alert('Название не может быть пустым');
                        return;
                    }

                    if (newName !== datasetName) {
                        const renameResp = await fetch(`/api/datasets/${encodeURIComponent(datasetName)}/rename_dataset`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ new_name: newName })
                        });
                        const renameData = await renameResp.json();
                        if (renameData.error) {
                            alert('Ошибка переименования: ' + renameData.error);
                            return;
                        }
                        datasetName = renameData.new_name;
                    }

                    if (coverInput.files.length > 0) {
                        const formData = new FormData();
                        formData.append('cover', coverInput.files[0]);
                        const coverResp = await fetch(`/api/datasets/${encodeURIComponent(datasetName)}/cover`, {
                            method: 'POST',
                            body: formData
                        });
                        const coverData = await coverResp.json();
                        if (coverData.error) {
                            alert('Ошибка загрузки обложки: ' + coverData.error);
                            return;
                        }
                    }

                    modal.remove();
                    window.DatasetsTab.showDatasetsList();
                });
            })
            .catch(err => alert('Ошибка загрузки данных: ' + err));
    }

    function showManageFlagsModal() {
        fetch('/api/flags')
            .then(res => res.json())
            .then(flags => {
                const modal = document.createElement('div');
                modal.className = 'modal show dataset-modal';
                modal.innerHTML = `
                    <div class="modal-content modal-small">
                        <div class="modal-body">
                            <h3>${t('manage_flags')}</h3>
                            <div class="flags-list" id="flagsList"></div>
                        </div>
                        <div class="modal-footer">
                            <button class="btn-secondary" id="closeFlagsModal">${t('close')}</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
                const closeModal = setupModalClosure(modal);

                const flagsList = document.getElementById('flagsList');
                let isAdding = false;

                function renderFlagsList() {
                    flagsList.innerHTML = '';

                    const addItem = document.createElement('div');
                    addItem.className = 'flag-item add-flag-item';

                    if (isAdding) {
                        addItem.innerHTML = `
                            <input type="text" id="newFlagNameInput" placeholder="${t('flag_name')}" value="" class="mass-input" style="flex: 1; margin-right: 8px;">
                            <div class="flag-color-picker" style="position: relative; width: 32px; height: 32px; border-radius: 50%; background-color: #3b82f6; cursor: pointer; flex-shrink: 0;"></div>
                            <input type="color" id="newFlagColorInput" value="#3b82f6" style="position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none;">
                            <button class="flag-save-btn" style="background: none; border: none; color: #10b981; cursor: pointer; margin-left: 4px;" title="${t('save')}">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                            </button>
                            <button class="flag-cancel-btn" style="background: none; border: none; color: #ef4444; cursor: pointer;" title="${t('cancel')}">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                        `;

                        const colorDiv = addItem.querySelector('.flag-color-picker');
                        const colorInput = addItem.querySelector('#newFlagColorInput');
                        colorDiv.style.backgroundColor = colorInput.value;
                        colorDiv.addEventListener('click', () => colorInput.click());
                        colorInput.addEventListener('input', (e) => {
                            colorDiv.style.backgroundColor = e.target.value;
                        });

                        const nameInput = addItem.querySelector('#newFlagNameInput');
                        const clearError = () => nameInput.classList.remove('error');
                        nameInput.addEventListener('input', clearError);

                        addItem.querySelector('.flag-save-btn').addEventListener('click', () => {
                            const name = nameInput.value.trim();
                            const color = colorInput.value;
                            if (!name) {
                                nameInput.classList.add('error');
                                return;
                            }
                            const exists = flags.some(flag => flag.name.toLowerCase() === name.toLowerCase());
                            if (exists) {
                                nameInput.classList.add('error');
                                return;
                            }
                            fetch('/api/flags', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ name, color })
                            })
                            .then(res => res.json())
                            .then(data => {
                                if (data.error) {
                                    alert(data.error);
                                } else {
                                    isAdding = false;
                                    return fetch('/api/flags');
                                }
                            })
                            .then(res => res ? res.json() : null)
                            .then(newFlags => {
                                if (newFlags) {
                                    flags = newFlags;
                                    renderFlagsList();
                                }
                            })
                            .catch(err => alert(err));
                        });

                        addItem.querySelector('.flag-cancel-btn').addEventListener('click', () => {
                            isAdding = false;
                            renderFlagsList();
                        });

                        addItem.querySelector('.flag-cancel-btn').addEventListener('click', () => {
                            isAdding = false;
                            renderFlagsList();
                        });
                    } else {
                        addItem.innerHTML = `
                            <div class="add-flag-button">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                                <span>${t('add_flag')}</span>
                            </div>
                        `;
                        addItem.querySelector('.add-flag-button').addEventListener('click', () => {
                            isAdding = true;
                            renderFlagsList();
                        });
                    }

                    flagsList.appendChild(addItem);

                    flags.forEach(flag => {
                        const flagItem = document.createElement('div');
                        flagItem.className = 'flag-item';

                        const flagChip = document.createElement('span');
                        flagChip.className = 'version-flag';
                        flagChip.style.borderColor = flag.color;
                        flagChip.textContent = flag.name;

                        const deleteBtn = document.createElement('button');
                        deleteBtn.className = 'flag-delete-btn';
                        deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>';
                        deleteBtn.dataset.name = flag.name;
                        deleteBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            fetch(`/api/flags/${encodeURIComponent(flag.name)}`, { method: 'DELETE' })
                                .then(res => res.json())
                                .then(() => fetch('/api/flags'))
                                .then(res => res.json())
                                .then(newFlags => {
                                    flags = newFlags;
                                    renderFlagsList();
                                })
                                .catch(err => alert(err));
                        });

                        flagItem.appendChild(flagChip);
                        flagItem.appendChild(deleteBtn);
                        flagsList.appendChild(flagItem);
                    });
                }

                renderFlagsList();

                document.getElementById('closeFlagsModal').addEventListener('click', closeModal);
            });
    }

    function showRenameModal(oldName, isDirectory = false) {
        let displayName = oldName;
        if (!isDirectory) {
            const lastDot = oldName.lastIndexOf('.');
            if (lastDot !== -1) {
                displayName = oldName.substring(0, lastDot);
            }
        }
        const modal = document.createElement('div');
        modal.className = 'modal show dataset-modal';
        modal.innerHTML = `
            <div class="modal-content modal-small">
                <div class="modal-body">
                    <h3>${t('rename')}</h3>
                    <input type="text" id="renameInput" value="${escapeHtml(displayName)}" class="mass-input">
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" id="cancelRename">${t('cancel')}</button>
                    <button class="btn-primary" id="confirmRename">${t('rename')}</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const closeModal = setupModalClosure(modal);

        document.getElementById('cancelRename').addEventListener('click', closeModal);
        document.getElementById('confirmRename').addEventListener('click', () => {
            let newName = document.getElementById('renameInput').value.trim();
            if (!newName) {
                modal.remove();
                return;
            }
            if (!isDirectory) {
                const ext = oldName.includes('.') ? oldName.substring(oldName.lastIndexOf('.')) : '';
                newName = newName + ext;
            }
            if (newName === oldName) {
                modal.remove();
                return;
            }
            renameItem(oldName, newName, modal);
        });
    }

    function showDeleteConfirmModal(name) {
        const modal = document.createElement('div');
        modal.className = 'modal show delete-modal dataset-modal';
        modal.innerHTML = `
            <div class="modal-content modal-small">
                <div class="modal-body">
                    <p>${t('confirm_delete_item')} <strong>${escapeHtml(name)}</strong>?</p>
                    <label class="custom-checkbox">
                        <input type="checkbox" id="dontAskDeleteItemCheckbox">
                        <span class="checkmark"></span>
                        <span>${t('dont_ask_again')}</span>
                    </label>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" id="cancelDelete">${t('cancel')}</button>
                    <button class="btn-danger" id="confirmDelete">${t('delete')}</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const closeModal = setupModalClosure(modal);

        document.getElementById('cancelDelete').addEventListener('click', closeModal);
        document.getElementById('confirmDelete').addEventListener('click', () => {
            const dontAsk = document.getElementById('dontAskDeleteItemCheckbox').checked;
            if (dontAsk) {
                sessionStorage.setItem('dontAskDeleteItem', 'true');
            }
            closeModal();
            deleteItem(name, null);
        });
    }

    function showDeleteDatasetConfirm(datasetName) {
        if (sessionStorage.getItem('dontAskDeleteDataset') === 'true') {
            deleteDataset(datasetName);
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal show delete-modal dataset-modal';
        modal.innerHTML = `
            <div class="modal-content modal-small">
                <div class="modal-body">
                    <p>${t('confirm_delete_dataset')} <strong>${escapeHtml(datasetName)}</strong>?</p>
                    <label class="custom-checkbox">
                        <input type="checkbox" id="dontAskDeleteDatasetCheckbox">
                        <span class="checkmark"></span>
                        <span>${t('dont_ask_again')}</span>
                    </label>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" id="cancelDeleteDataset">${t('cancel')}</button>
                    <button class="btn-danger" id="confirmDeleteDataset">${t('delete')}</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const closeModal = setupModalClosure(modal);

        document.getElementById('cancelDeleteDataset').addEventListener('click', closeModal);
        document.getElementById('confirmDeleteDataset').addEventListener('click', () => {
            const dontAsk = document.getElementById('dontAskDeleteDatasetCheckbox').checked;
            if (dontAsk) {
                sessionStorage.setItem('dontAskDeleteDataset', 'true');
            }
            closeModal();
            deleteDataset(datasetName);
        });
    }

    async function deleteDataset(datasetName) {
        const resp = await fetch(`/api/datasets/${encodeURIComponent(datasetName)}`, {
            method: 'DELETE'
        });
        const data = await resp.json();
        if (data.error) {
            alert(data.error);
        } else {
            window.DatasetsTab.showDatasetsList();
        }
    }

    function renameItem(oldName, newName, modal) {
        fetch(`/api/datasets/${encodeURIComponent(currentDataset)}/rename`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ old_name: oldName, new_name: newName, current_path: currentPath })
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                alert(data.error);
            } else {
                modal.remove();
                window.DatasetsTab.browse();
            }
        })
        .catch(err => alert('Ошибка: ' + err));
    }

    function deleteItem(name, modal) {
        fetch(`/api/datasets/${encodeURIComponent(currentDataset)}/delete`, {
            method: 'DELETE',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name: name, current_path: currentPath })
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                alert(data.error);
            } else {
                if (modal) modal.remove();
                window.DatasetsTab.browse();
            }
        })
        .catch(err => alert('Ошибка: ' + err));
    }

    let previewModal = null;

    function openImagePreview(src, filename) {
        const uniqueSrc = src.includes('?') ? src + '&_=' + Date.now() : src + '?_=' + Date.now();

        if (previewModal) closeImagePreview();

        previewModal = document.createElement('div');
        previewModal.className = 'preview-modal';
        previewModal.innerHTML = `
            <div class="preview-content">
                <img src="${uniqueSrc}" alt="${escapeHtml(filename)}">
            </div>
            <div class="preview-filename">${escapeHtml(filename)}</div>
        `;
        document.body.appendChild(previewModal);

        requestAnimationFrame(() => {
            previewModal.classList.add('show');
        });

        previewModal.addEventListener('click', closeImagePreview);
        document.addEventListener('keydown', previewKeyHandler);
    }

    function closeImagePreview() {
        if (!previewModal) return;
        previewModal.classList.remove('show');
        document.removeEventListener('keydown', previewKeyHandler);
        setTimeout(() => {
            if (previewModal && previewModal.parentNode) {
                previewModal.parentNode.removeChild(previewModal);
                previewModal = null;
            }
        }, 250);
    }

    function previewKeyHandler(e) {
        if (e.key === 'Escape') {
            closeImagePreview();
        }
    }
})();