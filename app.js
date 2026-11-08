/**
 * YouTube Loader - Pure Static JS Application
 */

// ==========================================
// ⚙️ CONFIGURATION: Paste your Google Client ID here to pre-configure
// the app and hide settings gear/instructions for your team:
const CONFIG_CLIENT_ID = "223426074652-l0qsjsunq1ofo1e2f74fkormc9m74m96.apps.googleusercontent.com";
// ==========================================

// Check if this is an OAuth popup callback redirecting back to our origin
if (window.opener && window.location.hash) {
  const params = new URLSearchParams(window.location.hash.substring(1));
  const accessToken = params.get('access_token');
  const expiresIn = params.get('expires_in');
  const error = params.get('error_description') || params.get('error');

  if (accessToken || error) {
    window.opener.postMessage({
      type: 'GOOGLE_OAUTH_RESPONSE',
      accessToken,
      expiresIn: expiresIn ? parseInt(expiresIn) : 3600,
      error
    }, window.location.origin);
    
    // Halt execution and close popup
    document.body.innerHTML = `
      <div style="
        font-family: 'Inter', -apple-system, sans-serif;
        display: flex;
        flex-direction: column;
        height: 100vh;
        align-items: center;
        justify-content: center;
        background: #090d16;
        color: #f8fafc;
        text-align: center;
        gap: 16px;
      ">
        <h2 style="font-weight: 600; margin: 0;">${error ? 'Ошибка входа' : 'Вход выполнен!'}</h2>
        <p style="color: #94a3b8; margin: 0; font-size: 0.9rem;">
          ${error ? error : 'Это окно закроется автоматически.'}
        </p>
      </div>
    `;
    setTimeout(() => {
      window.close();
    }, 1000);
    throw new Error("OAuth callback execution completed. Halting parent script execution inside popup.");
  }
}

// Parent Page App Execution
document.addEventListener('DOMContentLoaded', () => {
  
  // State
  let clientId = CONFIG_CLIENT_ID || localStorage.getItem('yt_loader_client_id') || '';
  let namePrefix = localStorage.getItem('yt_loader_name_prefix') || 'Мое видео';
  let accessToken = '';
  let tokenExpiresAt = 0;
  let channelInfo = null;
  let namingMode = 'global'; // 'global' or 'individual'
  
  let uploads = [];
  let isUploadingBatch = false;
  let cancelTokens = {};
  
  // DOM Elements
  const btnSettingsToggle = document.getElementById('btn-settings-toggle');
  const btnLogout = document.getElementById('btn-logout');
  const settingsModal = document.getElementById('settings-modal');
  const btnSettingsClose = document.getElementById('btn-settings-close');
  const btnSettingsCancel = document.getElementById('btn-settings-cancel');
  const btnSettingsSave = document.getElementById('btn-settings-save');
  const inputClientId = document.getElementById('input-client-id');
  const inputNamePrefix = document.getElementById('input-name-prefix');
  const radiosNamingMode = document.getElementsByName('naming-mode');
  const globalNameGroup = document.getElementById('global-name-group');
  
  const authSignedOut = document.getElementById('auth-signed-out');
  const authSignedIn = document.getElementById('auth-signed-in');
  const authErrorAlert = document.getElementById('auth-error-alert');
  const authErrorText = document.getElementById('auth-error-text');
  const btnLogin = document.getElementById('btn-login');
  const btnLoginText = document.getElementById('btn-login-text');
  const userAvatar = document.getElementById('user-avatar');
  const userAvatarPlaceholder = document.getElementById('user-avatar-placeholder');
  const userName = document.getElementById('user-name');
  
  const helperGuideDeveloper = document.getElementById('helper-guide-developer');
  const helperGuideUser = document.getElementById('helper-guide-user');
  
  const dropzone = document.getElementById('dropzone');
  const filePicker = document.getElementById('file-picker');
  
  const queueBadge = document.getElementById('queue-badge');
  const btnClearCompleted = document.getElementById('btn-clear-completed');
  const queueList = document.getElementById('queue-list');
  const queueFooter = document.getElementById('queue-footer');
  const btnStartUploads = document.getElementById('btn-start-uploads');
  const btnStartText = document.getElementById('btn-start-text');

  // Initialize
  initUI();
  loadAuthFromStorage();

  // Listeners for naming mode
  radiosNamingMode.forEach(radio => {
    radio.addEventListener('change', (e) => {
      namingMode = e.target.value;
      if (namingMode === 'global') {
        globalNameGroup.style.display = 'block';
      } else {
        globalNameGroup.style.display = 'none';
      }
      renderUploads();
    });
  });

  function initUI() {
    inputNamePrefix.value = namePrefix;
    inputClientId.value = clientId;

    // Toggle setup helper guides and settings gear if pre-configured
    if (CONFIG_CLIENT_ID) {
      btnSettingsToggle.style.display = 'none';
      helperGuideDeveloper.style.display = 'none';
      helperGuideUser.style.display = 'block';
    } else {
      btnSettingsToggle.style.display = 'flex';
      helperGuideDeveloper.style.display = 'block';
      helperGuideUser.style.display = 'none';
      if (!clientId) {
        settingsModal.style.display = 'flex';
      }
    }

    // Lucide Icons Render
    lucide.createIcons();
  }

  // Persistent Auth Check
  function loadAuthFromStorage() {
    const savedToken = localStorage.getItem('yt_loader_access_token') || '';
    const savedExpiresAt = localStorage.getItem('yt_loader_token_expires_at');
    
    if (savedToken && savedExpiresAt) {
      const expiresAt = parseInt(savedExpiresAt);
      if (Date.now() < expiresAt - 30 * 1000) {
        accessToken = savedToken;
        tokenExpiresAt = expiresAt;
        updateAuthState(true);
        fetchChannelInfo(savedToken);
        return;
      }
    }
    updateAuthState(false);
  }

  // Listen for Google OAuth message callback from popup
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    
    if (event.data?.type === 'GOOGLE_OAUTH_RESPONSE') {
      setAuthLoadingState(false);
      const { accessToken: token, expiresIn, error } = event.data;
      
      if (error) {
        showAuthError(error);
      } else if (token) {
        accessToken = token;
        tokenExpiresAt = Date.now() + expiresIn * 1000;
        
        // Save to LocalStorage for persistence
        localStorage.setItem('yt_loader_access_token', token);
        localStorage.setItem('yt_loader_token_expires_at', tokenExpiresAt.toString());
        
        hideAuthError();
        updateAuthState(true);
        fetchChannelInfo(token);
      }
    }
  });

  // Fetch YouTube Channel Details
  async function fetchChannelInfo(token) {
    try {
      const response = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (response.ok) {
        const data = await response.json();
        const snippet = data?.items?.[0]?.snippet;
        if (snippet) {
          channelInfo = {
            name: snippet.title,
            avatar: snippet.thumbnails?.default?.url || ''
          };
          
          userName.textContent = channelInfo.name;
          if (channelInfo.avatar) {
            userAvatar.src = channelInfo.avatar;
            userAvatar.style.display = 'block';
            userAvatarPlaceholder.style.display = 'none';
          }
        }
      }
    } catch (e) {
      console.error('Failed to fetch channel details', e);
    }
  }

  // Google Sign In trigger (Centered Popup)
  function handleSignIn() {
    if (!clientId) {
      settingsModal.style.display = 'flex';
      return;
    }

    setAuthLoadingState(true);
    hideAuthError();

    const redirectUri = window.location.origin;
    const scope = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}&prompt=consent`;

    const width = 600;
    const height = 650;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const popup = window.open(
      authUrl,
      'google-oauth',
      `width=${width},height=${height},top=${top},left=${left},status=no,resizable=yes,scrollbars=yes`
    );

    if (!popup) {
      setAuthLoadingState(false);
      showAuthError('Не удалось открыть окно авторизации. Пожалуйста, разрешите всплывающие окна в браузере.');
      return;
    }

    // Monitor for manual window close
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        setTimeout(() => {
          // If token wasn't fetched, reset loading state
          if (!accessToken) {
            setAuthLoadingState(false);
          }
        }, 1000);
      }
    }, 500);
  }

  // Sign Out
  function handleSignOut() {
    accessToken = '';
    tokenExpiresAt = 0;
    channelInfo = null;
    localStorage.removeItem('yt_loader_access_token');
    localStorage.removeItem('yt_loader_token_expires_at');
    updateAuthState(false);
  }

  // UI State helper
  function updateAuthState(isSignedIn) {
    if (isSignedIn) {
      authSignedOut.style.display = 'none';
      authSignedIn.style.display = 'block';
      btnLogout.style.display = 'flex';
    } else {
      authSignedOut.style.display = 'block';
      authSignedIn.style.display = 'none';
      btnLogout.style.display = 'none';
      
      // Clear profile card
      userName.textContent = 'YouTube канал';
      userAvatar.style.display = 'none';
      userAvatarPlaceholder.style.display = 'flex';
    }
    updateStartButtonState();
  }

  function setAuthLoadingState(isLoading) {
    if (isLoading) {
      btnLogin.disabled = true;
      btnLoginText.textContent = 'Инициализация...';
    } else {
      btnLogin.disabled = false;
      btnLoginText.textContent = 'Войти через Google';
    }
  }

  function showAuthError(msg) {
    authErrorText.textContent = msg;
    authErrorAlert.style.display = 'flex';
  }

  function hideAuthError() {
    authErrorAlert.style.display = 'none';
  }

  // Settings Handlers
  btnSettingsToggle.addEventListener('click', () => {
    inputClientId.value = clientId;
    settingsModal.style.display = 'flex';
  });
  btnSettingsClose.addEventListener('click', () => settingsModal.style.display = 'none');
  btnSettingsCancel.addEventListener('click', () => settingsModal.style.display = 'none');
  btnSettingsSave.addEventListener('click', () => {
    clientId = inputClientId.value.trim();
    localStorage.setItem('yt_loader_client_id', clientId);
    settingsModal.style.display = 'none';
    if (!CONFIG_CLIENT_ID) {
      helperGuideDeveloper.style.display = 'block';
    }
  });

  // Name Prefix Handler
  inputNamePrefix.addEventListener('input', (e) => {
    namePrefix = e.target.value;
    localStorage.setItem('yt_loader_name_prefix', namePrefix);
  });

  // Drag & Drop
  dropzone.addEventListener('dragenter', handleDrag);
  dropzone.addEventListener('dragover', handleDrag);
  dropzone.addEventListener('dragleave', handleDrag);
  dropzone.addEventListener('drop', handleDrop);
  dropzone.addEventListener('click', () => filePicker.click());
  filePicker.addEventListener('change', handleFileSelect);

  function handleDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      dropzone.classList.add('drag-active');
    } else {
      dropzone.classList.remove('drag-active');
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('drag-active');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(Array.from(e.dataTransfer.files));
    }
  }

  function handleFileSelect(e) {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(Array.from(e.target.files));
    }
  }

  // Smart naming logic for file selection
  function addFilesToQueue(files) {
    const videoFiles = files.filter(file => file.type.startsWith('video/'));
    
    if (videoFiles.length === 0) {
      alert('Пожалуйста, выберите видео файлы (MP4, WebM, MOV и т.д.)');
      return;
    }

    const newUploads = videoFiles.map((file) => {
      const id = Math.random().toString(36).substring(2, 11);
      
      let calculatedName = '';
      if (namingMode === 'global') {
        calculatedName = namePrefix || file.name.replace(/\.[^/.]+$/, "");
      } else {
        calculatedName = file.name.replace(/\.[^/.]+$/, "");
      }

      return {
        id,
        file,
        name: calculatedName,
        progress: 0,
        status: 'queued', // queued, uploading, success, error
        speed: 0,
        uploadedBytes: 0,
        totalBytes: file.size,
        errorMessage: ''
      };
    });

    uploads = [...uploads, ...newUploads];
    renderUploads();
  }

  // Render Queue List UI dynamically
  function renderUploads() {
    // Update badge count
    if (uploads.length > 0) {
      queueBadge.textContent = uploads.length;
      queueBadge.style.display = 'inline-block';
      queueFooter.style.display = 'block';
    } else {
      queueBadge.style.display = 'none';
      queueFooter.style.display = 'none';
    }

    // Toggle Clear Completed Button
    const hasCompleted = uploads.some(item => item.status === 'success' || item.status === 'error');
    if (hasCompleted && !isUploadingBatch) {
      btnClearCompleted.style.display = 'block';
    } else {
      btnClearCompleted.style.display = 'none';
    }

    if (uploads.length === 0) {
      queueList.innerHTML = `
        <div class="empty-queue">
          <i data-lucide="file-video" style="width: 48px; height: 48px; stroke-width: 1;"></i>
          <div>Очередь пуста</div>
          <p style="font-size: 0.8rem; color: var(--text-muted);">
            Добавьте файлы, перетащив их выше, чтобы начать
          </p>
        </div>
      `;
      lucide.createIcons();
      updateStartButtonState();
      return;
    }

    let html = '';
    uploads.forEach(item => {
      const isUploading = item.status === 'uploading';
      const isSuccess = item.status === 'success';
      const isError = item.status === 'error';
      const isQueued = item.status === 'queued';
      
      let badgeLabel = 'В очереди';
      if (isUploading) badgeLabel = 'Загрузка';
      if (isSuccess) badgeLabel = 'Завершено';
      if (isError) badgeLabel = 'Ошибка';

      // Decide if title should be editable
      let titleHtml = '';
      if (namingMode === 'individual' && isQueued) {
        titleHtml = `
          <input 
            type="text" 
            class="input-text item-title-input" 
            value="${escapeHtml(item.name)}" 
            data-id="${item.id}" 
            placeholder="Введите название видео" 
            style="padding: 6px 10px; font-size: 0.9rem; margin-top: 4px; width: 100%; max-width: 320px;" 
          />
        `;
      } else {
        titleHtml = `<div class="item-name">${escapeHtml(item.name)}</div>`;
      }

      html += `
        <div class="queue-item status-${item.status}" id="item-${item.id}">
          <div class="item-top">
            <div class="item-meta">
              ${titleHtml}
              <div class="item-filename">
                ${escapeHtml(item.file.name)} • ${formatSize(item.totalBytes)}
              </div>
            </div>
            <div class="item-right">
              <span class="status-badge ${item.status}">${badgeLabel}</span>
              ${!isUploadingBatch ? `
                <button class="item-action-btn btn-delete" data-id="${item.id}" title="Удалить">
                  <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                </button>
              ` : isUploading ? `
                <button class="item-action-btn btn-cancel" data-id="${item.id}" title="Отмена">
                  <i data-lucide="x" style="width: 16px; height: 16px;"></i>
                </button>
              ` : ''}
            </div>
          </div>

          ${(isUploading || isSuccess || item.progress > 0) ? `
            <div class="item-progress-section">
              <div class="progress-bar-container">
                <div class="progress-bar-fill" style="width: ${item.progress}%" id="progress-${item.id}"></div>
              </div>
              <div class="progress-stats">
                <span id="percent-${item.id}">${item.progress}%</span>
                <div class="progress-speed-eta" id="speed-eta-${item.id}" style="${isUploading ? '' : 'display: none;'}">
                  <span>${formatSpeed(item.speed)}</span>
                  <span>Осталось: ${formatTime(item.remainingTime)}</span>
                </div>
              </div>
            </div>
          ` : ''}

          ${isError ? `
            <div class="error-alert">
              <i data-lucide="alert-circle" style="width: 14px; height: 14px; flex-shrink: 0;"></i>
              <span>${escapeHtml(item.errorMessage)}</span>
            </div>
          ` : ''}

          ${isSuccess && item.youtubeId ? `
            <div class="success-link-box">
              <a href="https://youtu.be/${item.youtubeId}" target="_blank" rel="noopener noreferrer" class="success-link-text">
                <i data-lucide="youtube" style="width: 14px; height: 14px; color: var(--color-error); flex-shrink: 0;"></i>
                youtu.be/${item.youtubeId}
                <i data-lucide="external-link" style="width: 12px; height: 12px;"></i>
              </a>
              <button class="copy-btn btn-copy" data-videoid="${item.youtubeId}" data-id="${item.id}">
                <i data-lucide="copy" style="width: 14px; height: 14px;" id="copy-icon-${item.id}"></i>
              </button>
            </div>
          ` : ''}
        </div>
      `;
    });

    queueList.innerHTML = html;
    lucide.createIcons();
    bindQueueItemEvents();
    updateStartButtonState();
  }

  function bindQueueItemEvents() {
    // Delete buttons
    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        removeUpload(id);
      });
    });

    // Cancel buttons
    document.querySelectorAll('.btn-cancel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        removeUpload(id);
      });
    });

    // Copy buttons
    document.querySelectorAll('.btn-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const videoId = btn.getAttribute('data-videoid');
        const id = btn.getAttribute('data-id');
        copyLink(videoId, id);
      });
    });

    // Title input changes (for individual names)
    document.querySelectorAll('.item-title-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const id = input.getAttribute('data-id');
        const item = uploads.find(u => u.id === id);
        if (item) {
          item.name = e.target.value;
        }
      });
    });
  }

  function removeUpload(id) {
    if (cancelTokens[id]) {
      cancelTokens[id]();
      delete cancelTokens[id];
    }
    uploads = uploads.filter(item => item.id !== id);
    renderUploads();
  }

  function copyLink(videoId, itemId) {
    const url = `https://youtu.be/${videoId}`;
    navigator.clipboard.writeText(url).then(() => {
      const copyIcon = document.getElementById(`copy-icon-${itemId}`);
      if (copyIcon) {
        copyIcon.setAttribute('data-lucide', 'check');
        copyIcon.style.color = 'var(--color-success)';
        lucide.createIcons();
        setTimeout(() => {
          copyIcon.setAttribute('data-lucide', 'copy');
          copyIcon.style.color = '';
          lucide.createIcons();
        }, 2000);
      }
    });
  }

  // Clear completed uploads
  btnClearCompleted.addEventListener('click', () => {
    uploads = uploads.filter(item => item.status !== 'success' && item.status !== 'error');
    renderUploads();
  });

  // Check token expiration
  function isTokenExpired() {
    return !accessToken || Date.now() > tokenExpiresAt - 30 * 1000;
  }

  function updateStartButtonState() {
    const hasActiveQueue = uploads.some(item => item.status === 'queued');
    btnStartUploads.disabled = isUploadingBatch || !accessToken || !hasActiveQueue;
    
    if (isUploadingBatch) {
      btnStartText.textContent = 'Выполняется загрузка...';
    } else if (!accessToken) {
      btnStartText.textContent = 'Авторизуйтесь для загрузки';
    } else {
      btnStartText.textContent = 'Запустить загрузку файлов';
    }
  }

  // Start uploading sequentially
  async function handleStartUploads() {
    if (isTokenExpired()) {
      alert('Срок действия сессии Google истек. Пожалуйста, авторизуйтесь снова.');
      handleSignIn();
      return;
    }

    if (namingMode === 'global') {
      uploads.forEach(item => {
        if (item.status === 'queued') {
          item.name = namePrefix || item.name;
        }
      });
    }

    isUploadingBatch = true;
    renderUploads();

    while (true) {
      const nextToUpload = uploads.find(item => item.status === 'queued');
      if (!nextToUpload) {
        break;
      }

      const activeId = nextToUpload.id;
      try {
        await executeSingleUpload(activeId);
      } catch (e) {
        console.error(`Sequential upload stopped on error for ID ${activeId}`, e);
        break;
      }
    }

    isUploadingBatch = false;
    renderUploads();
  }

  // Single Upload Executor (returns a Promise)
  function executeSingleUpload(id) {
    return new Promise((resolve) => {
      // Find item
      const item = uploads.find(u => u.id === id);
      if (!item) {
        resolve();
        return;
      }

      item.status = 'uploading';
      renderUploads();

      let isCancelled = false;
      let xhrMetadata = null;
      let xhrUpload = null;

      const cancel = () => {
        isCancelled = true;
        if (xhrMetadata) xhrMetadata.abort();
        if (xhrUpload) xhrUpload.abort();
      };
      cancelTokens[id] = cancel;

      // 1. Post video metadata to initiate resumable upload session
      xhrMetadata = new XMLHttpRequest();
      const initUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
      xhrMetadata.open('POST', initUrl, true);
      xhrMetadata.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      xhrMetadata.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
      xhrMetadata.setRequestHeader('X-Upload-Content-Length', item.file.size.toString());
      xhrMetadata.setRequestHeader('X-Upload-Content-Type', item.file.type || 'video/mp4');

      const metadataBody = {
        snippet: {
          title: item.name,
          description: 'Uploaded via YouTube Loader static client application.',
          categoryId: '22',
          defaultLanguage: 'ru'
        },
        status: {
          privacyStatus: 'unlisted',
          selfDeclaredMadeForKids: false
        }
      };

      xhrMetadata.onreadystatechange = () => {
        if (isCancelled) return;

        if (xhrMetadata.readyState === 4) {
          if (xhrMetadata.status === 200 || xhrMetadata.status === 201) {
            const locationUrl = xhrMetadata.getResponseHeader('Location');
            if (locationUrl) {
              startByteUpload(locationUrl);
            } else {
              handleUploadError('Не удалось прочесть URL сессии загрузки YouTube.');
            }
          } else {
            handleApiError(xhrMetadata);
          }
        }
      };

      xhrMetadata.onerror = () => {
        if (!isCancelled) handleUploadError('Сетевая ошибка при инициализации сессии.');
      };

      xhrMetadata.send(JSON.stringify(metadataBody));

      // 2. Perform the PUT request with file contents
      function startByteUpload(locationUrl) {
        if (isCancelled) return;

        xhrUpload = new XMLHttpRequest();
        xhrUpload.open('PUT', locationUrl, true);
        xhrUpload.setRequestHeader('Content-Type', item.file.type || 'video/mp4');

        let startTime = Date.now();
        let lastLoaded = 0;
        let lastTime = startTime;

        xhrUpload.upload.onprogress = (event) => {
          if (isCancelled) return;

          if (event.lengthComputable) {
            const now = Date.now();
            const loaded = event.loaded;
            const total = event.total;

            const timeDiff = (now - lastTime) / 1000;
            let speed = 0;
            if (timeDiff > 0.1) {
              const bytesDiff = loaded - lastLoaded;
              speed = bytesDiff / timeDiff;
              lastLoaded = loaded;
              lastTime = now;
            } else {
              const totalElapsed = (now - startTime) / 1000;
              speed = totalElapsed > 0 ? loaded / totalElapsed : 0;
            }

            const remainingBytes = total - loaded;
            const remainingTime = speed > 0 ? remainingBytes / speed : 0;

            // Live progress update in data
            item.progress = Math.round((loaded / total) * 100);
            item.speed = speed;
            item.remainingTime = remainingTime;

            // Live DOM updates for performance (to avoid full re-renders on every progress tick)
            const progressBar = document.getElementById(`progress-${id}`);
            const percentLabel = document.getElementById(`percent-${id}`);
            const speedEtaBox = document.getElementById(`speed-eta-${id}`);
            
            if (progressBar) progressBar.style.width = `${item.progress}%`;
            if (percentLabel) percentLabel.textContent = `${item.progress}%`;
            if (speedEtaBox) {
              speedEtaBox.style.display = 'flex';
              speedEtaBox.innerHTML = `<span>${formatSpeed(speed)}</span><span>Осталось: ${formatTime(remainingTime)}</span>`;
            }
          }
        };

        xhrUpload.onreadystatechange = () => {
          if (isCancelled) return;

          if (xhrUpload.readyState === 4) {
            if (xhrUpload.status === 200 || xhrUpload.status === 201) {
              try {
                const response = JSON.parse(xhrUpload.responseText);
                const videoId = response.id;
                if (videoId) {
                  item.status = 'success';
                  item.progress = 100;
                  item.youtubeId = videoId;
                  delete cancelTokens[id];
                  renderUploads();
                  resolve();
                } else {
                  handleUploadError('Загрузка успешна, но YouTube не вернул ID видео.');
                }
              } catch (e) {
                handleUploadError('Ошибка парсинга ответа YouTube.');
              }
            } else {
              handleApiError(xhrUpload);
            }
          }
        };

        xhrUpload.onerror = () => {
          if (!isCancelled) handleUploadError('Сетевая ошибка при передаче видеофайла.');
        };

        xhrUpload.send(item.file);
      }

      function handleApiError(xhr) {
        try {
          const response = JSON.parse(xhr.responseText);
          const apiError = response?.error;
          if (apiError) {
            const message = apiError.errors?.[0]?.message || apiError.message || `Ошибка API (${xhr.status})`;
            if (message.includes('quotaExceeded') || xhr.status === 403) {
              handleUploadError(`Лимит квот YouTube превышен. Лимит бесплатного проекта — около 6 загрузок в день. ${message}`);
            } else {
              handleUploadError(message);
            }
          } else {
            handleUploadError(`API вернул ошибку: Статус ${xhr.status}`);
          }
        } catch (e) {
          // Check for network errors masked by browser due to CORS on 403 error screens
          if (xhr.status === 0 || xhr.status === 403) {
            handleUploadError('Ошибка авторизации 403 (CORS). Убедитесь, что вы предоставили все разрешения в окне входа Google.');
          } else {
            handleUploadError(`API вернул статус ${xhr.status}`);
          }
        }
      }

      function handleUploadError(errorMsg) {
        item.status = 'error';
        item.errorMessage = errorMsg;
        delete cancelTokens[id];
        renderUploads();
        resolve();
      }
    });
  }

  // Bind main buttons
  btnLogin.addEventListener('click', handleSignIn);
  btnLogout.addEventListener('click', handleSignOut);
  btnStartUploads.addEventListener('click', handleStartUploads);

  // Formatting helpers
  function formatSpeed(bytesPerSec) {
    if (bytesPerSec === 0) return '0 Б/с';
    const k = 1024;
    const sizes = ['Б/с', 'КБ/с', 'МБ/с', 'ГБ/с'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatTime(seconds) {
    if (seconds === undefined || isNaN(seconds) || seconds === Infinity) return '--:--';
    if (seconds < 60) return `${Math.round(seconds)}с`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 60) return `${mins}м ${secs}с`;
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hrs}ч ${remainingMins}м`;
  }

  function formatSize(bytes) {
    if (bytes === 0) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

});
