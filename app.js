document.addEventListener('DOMContentLoaded', () => {
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const btnFileSelect = document.getElementById('btn-file-select');
  const workspace = document.getElementById('workspace');
  const canvasWrapper = document.getElementById('canvas-wrapper');

  const mainCanvas = document.getElementById('main-canvas');
  const overlayCanvas = document.getElementById('overlay-canvas');
  const ctx = mainCanvas.getContext('2d', { willReadFrequently: true });
  const overlayCtx = overlayCanvas.getContext('2d');

  const magnifier = document.getElementById('magnifier');
  const magCanvas = document.getElementById('mag-canvas');
  const magCtx = magCanvas.getContext('2d');
  magCtx.imageSmoothingEnabled = false;

  const btnCrop = document.getElementById('btn-crop');
  const btnOriginal = document.getElementById('btn-original');
  const btnCopyAll = document.getElementById('btn-copy-all');
  const btnSaveImg = document.getElementById('btn-save-img');
  const btnReset = document.getElementById('btn-reset');
  const btnCloseImg = document.getElementById('btn-close-img');
  const slotsContainer = document.getElementById('color-slots');

  let originalImage = null;
  let colors = [];
  let isCroppingMode = false;
  let isDraggingCrop = false;
  let cropStart = { x: 0, y: 0 };
  let cropCurrent = { x: 0, y: 0 };

  let targetMagX = 0, targetMagY = 0;
  let currentMagX = 0, currentMagY = 0;
  let magAnimationId = null;
  let longPressTimer = null;

  function showToast(msg) {
    const container = document.getElementById('toast-container');
    container.innerHTML = '';
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fadeOut');
      toast.addEventListener('animationend', () => toast.remove());
    }, 2000);
  }

  function getLuminance(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

  function rgbToHsbFormula(r, g, b) {
    let rr = r / 255, gg = g / 255, bb = b / 255;
    const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
    let h = 0, s = 0, v = max;
    const d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max !== min) {
      switch (max) {
        case rr: h = (gg - bb) / d + (gg < bb ? 6 : 0); break;
        case gg: h = (bb - rr) / d + 2; break;
        case bb: h = (rr - gg) / d + 4; break;
      }
      h /= 6;
    }
    let hPrime = Math.round((h * 360) * (512 / 360));
    let sPrime = Math.round((s * 100) * 5.12);
    let bPrime = Math.round((v * 100) * 5.12);
    return { h: hPrime, s: sPrime, b: bPrime };
  }

  function rgbToHex(r, g, b) {
    return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1).toUpperCase();
  }

  function getMappedCoords(e) {
    const rect = mainCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const canvasRatio = mainCanvas.width / mainCanvas.height;
    const cssRatio = rect.width / rect.height;

    let renderedW = rect.width, renderedH = rect.height;
    let offsetX = 0, offsetY = 0;

    if (canvasRatio > cssRatio) {
      renderedH = rect.width / canvasRatio;
      offsetY = (rect.height - renderedH) / 2;
    } else {
      renderedW = rect.height * canvasRatio;
      offsetX = (rect.width - renderedW) / 2;
    }

    const mouseXOnDOM = clientX - rect.left;
    const mouseYOnDOM = clientY - rect.top;

    const isValid = mouseXOnDOM >= offsetX && mouseXOnDOM <= offsetX + renderedW &&
      mouseYOnDOM >= offsetY && mouseYOnDOM <= offsetY + renderedH;

    const canvasX = ((mouseXOnDOM - offsetX) / renderedW) * mainCanvas.width;
    const canvasY = ((mouseYOnDOM - offsetY) / renderedH) * mainCanvas.height;

    const wrapperRect = canvasWrapper.getBoundingClientRect();

    return {
      x: Math.round(canvasX),
      y: Math.round(canvasY),
      isValid,
      rawX: clientX - wrapperRect.left,
      rawY: clientY - wrapperRect.top
    };
  }

  // [수정됨] 새 이미지 로드 시 기존 이미지 존재 여부 확인 및 초기화
  function loadImage(fileOrBlob) {
    if (!fileOrBlob.type.startsWith('image/')) { showToast('이미지 파일만 지원합니다.'); return; }
    if (fileOrBlob.size > 20 * 1024 * 1024) { showToast('20MB 초과 파일은 업로드할 수 없습니다.'); return; }

    // 이미지가 이미 띄워져 있는 상태에서 새로운 이미지를 부를 때
    if (originalImage) {
      if (!confirm('새로운 이미지를 불러오시겠습니까?\n(기존 이미지와 추출된 색상 데이터가 초기화됩니다)')) {
        return; // 취소 시 중단
      }
      colors = []; // 색상 초기화
      renderSlots();
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        originalImage = img;
        uploadZone.classList.add('hidden');
        workspace.classList.remove('hidden');
        resetCanvas(img);
        updateButtons();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(fileOrBlob);
  }

  function resetCanvas(img) {
    mainCanvas.width = img.width; mainCanvas.height = img.height;
    overlayCanvas.width = img.width; overlayCanvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    isCroppingMode = false;
    isDraggingCrop = false;
    canvasWrapper.style.cursor = 'default';
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }

  // 업로드 이벤트
  btnFileSelect.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => { if (e.target.files.length) loadImage(e.target.files[0]); });
  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault(); uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) loadImage(e.dataTransfer.files[0]);
  });

  // [수정됨] 붙여넣기 이벤트 - 클립보드 내 여러 파일이 있어도 한 번만 실행되도록 break 적용
  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let item of items) {
      if (item.type.indexOf('image/') === 0) {
        loadImage(item.getAsFile());
        break; // 이미지 여러 개 붙여넣기 방지
      }
    }
  });

  btnCloseImg.addEventListener('click', () => {
    if (confirm('현재 이미지를 삭제하시겠습니까?\n(추출된 색상 데이터도 함께 초기화됩니다)')) {
      workspace.classList.add('hidden'); uploadZone.classList.remove('hidden');
      originalImage = null; colors = []; renderSlots(); fileInput.value = '';
    }
  });

  btnOriginal.addEventListener('click', () => { if (originalImage) resetCanvas(originalImage); });

  // 돋보기 부드러운 스무딩
  function updateMagnifierPos() {
    currentMagX += (targetMagX - currentMagX) * 0.3;
    currentMagY += (targetMagY - currentMagY) * 0.3;
    let topOffset = currentMagY < 80 ? 70 : -70;
    magnifier.style.left = `${currentMagX}px`;
    magnifier.style.top = `${currentMagY + topOffset}px`;
    magAnimationId = requestAnimationFrame(updateMagnifierPos);
  }

  const handleMove = (e) => {
    if (!originalImage) return;
    const pos = getMappedCoords(e);

    if (isCroppingMode && isDraggingCrop) {
      cropCurrent = { x: pos.x, y: pos.y };
      drawCropOverlay();
    } else if (!isCroppingMode) {
      if (!pos.isValid) {
        magnifier.classList.add('hidden');
        return;
      }
      magnifier.classList.remove('hidden');
      targetMagX = pos.rawX; targetMagY = pos.rawY;
      if (!magAnimationId) updateMagnifierPos();

      magCtx.clearRect(0, 0, 80, 80);
      magCtx.drawImage(mainCanvas, pos.x - 5, pos.y - 5, 10, 10, 0, 0, 80, 80);
    }
  };

  const drawCropOverlay = () => {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    overlayCtx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const x = Math.min(cropStart.x, cropCurrent.x), y = Math.min(cropStart.y, cropCurrent.y);
    const w = Math.abs(cropStart.x - cropCurrent.x), h = Math.abs(cropStart.y - cropCurrent.y);
    overlayCtx.clearRect(x, y, w, h);
  };

  const handleStart = (e) => {
    if (e.target.closest('.btn-close-img') || !originalImage) return;

    const pos = getMappedCoords(e);
    if (!pos.isValid) return;

    if (isCroppingMode) {
      isDraggingCrop = true;
      cropStart = { x: pos.x, y: pos.y };
      cropCurrent = { ...cropStart };
    } else {
      if (e.type === 'touchstart') {
        e.preventDefault();
        longPressTimer = setTimeout(() => { extractColor(pos); }, 500);
      }
    }
  };

  const handleEnd = (e) => {
    if (longPressTimer) clearTimeout(longPressTimer);
    if (isCroppingMode && isDraggingCrop) {
      isDraggingCrop = false;
      const x = Math.min(cropStart.x, cropCurrent.x), y = Math.min(cropStart.y, cropCurrent.y);
      const w = Math.abs(cropStart.x - cropCurrent.x), h = Math.abs(cropStart.y - cropCurrent.y);

      if (w > 10 && h > 10) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w; tempCanvas.height = h;
        tempCanvas.getContext('2d').drawImage(mainCanvas, x, y, w, h, 0, 0, w, h);

        mainCanvas.width = w; mainCanvas.height = h;
        overlayCanvas.width = w; overlayCanvas.height = h;
        ctx.drawImage(tempCanvas, 0, 0);

        isCroppingMode = false;
        canvasWrapper.style.cursor = 'default';
        overlayCtx.clearRect(0, 0, w, h);
        showToast('크롭 완료');
      } else {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        isCroppingMode = false;
        canvasWrapper.style.cursor = 'default';
      }
    } else if (!isCroppingMode && e.type === 'mouseup' && !e.target.closest('.btn-close-img')) {
      extractColor(getMappedCoords(e));
    }
  };

  canvasWrapper.addEventListener('mousedown', handleStart);
  canvasWrapper.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleEnd);

  canvasWrapper.addEventListener('touchstart', handleStart, { passive: false });
  canvasWrapper.addEventListener('touchmove', handleMove, { passive: false });
  window.addEventListener('touchend', handleEnd);
  canvasWrapper.addEventListener('contextmenu', e => e.preventDefault());

  canvasWrapper.addEventListener('mouseleave', () => {
    magnifier.classList.add('hidden');
    cancelAnimationFrame(magAnimationId);
    magAnimationId = null;
  });

  btnCrop.addEventListener('click', () => {
    if (!originalImage) return;
    isCroppingMode = true;
    canvasWrapper.style.cursor = 'crosshair';
    magnifier.classList.add('hidden');

    overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    overlayCtx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    showToast('드래그하여 영역 선택');
  });

  function extractColor(pos) {
    if (!pos.isValid) return;
    if (colors.length >= 3) { showToast('슬롯이 꽉 찼습니다.'); return; }

    try {
      const pixel = ctx.getImageData(pos.x, pos.y, 1, 1).data;
      if (pixel[3] === 0) return;

      const r = pixel[0], g = pixel[1], b = pixel[2];
      const hex = rgbToHex(r, g, b);
      const hsbObj = rgbToHsbFormula(r, g, b);
      const hsbDisplay = `${hsbObj.h} · ${hsbObj.s} · ${hsbObj.b}`;
      const hsbCopy = `${hsbObj.h} / ${hsbObj.s} / ${hsbObj.b}`;

      if (colors.some(c => c.hex === hex)) { showToast('이미 저장된 색상입니다.'); return; }

      colors.push({ r, g, b, hex, hsbDisplay, hsbCopy });
      renderSlots();
    } catch (err) {
      console.error(err);
    }
  }

  function renderSlots() {
    slotsContainer.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const slot = document.createElement('div');
      if (colors[i]) {
        const c = colors[i];
        const lum = getLuminance(c.r, c.g, c.b);
        const closeColor = lum > 140 ? '#171717' : '#ffffff';

        slot.className = 'slot';
        slot.innerHTML = `
          <div class="color-card" draggable="true" data-index="${i}">
            <div class="card-top" style="background-color: ${c.hex};">
              <button class="card-close" style="color: ${closeColor}">×</button>
            </div>
            <div class="card-bottom" title="클릭하여 복사">
              <div class="card-hsb">${c.hsbDisplay}</div>
              <div class="card-hex-rgb">${c.hex} / RGB(${c.r}, ${c.g}, ${c.b})</div>
            </div>
          </div>
        `;

        slot.querySelector('.card-close').addEventListener('click', () => { colors.splice(i, 1); renderSlots(); });
        slot.querySelector('.card-bottom').addEventListener('click', () => {
          navigator.clipboard.writeText(c.hsbCopy).then(() => showToast('복사 완료'));
        });

        const card = slot.querySelector('.color-card');
        card.addEventListener('dragstart', e => e.dataTransfer.setData('idx', i));
        card.addEventListener('dragover', e => e.preventDefault());
        card.addEventListener('drop', e => {
          e.preventDefault();
          const fromIdx = e.dataTransfer.getData('idx');
          if (fromIdx !== "" && parseInt(fromIdx) !== i) {
            const temp = colors[fromIdx];
            colors.splice(fromIdx, 1); colors.splice(i, 0, temp);
            renderSlots();
          }
        });
      } else {
        slot.className = 'slot empty';
        slot.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
      }
      slotsContainer.appendChild(slot);
    }
    updateButtons();
  }

  function updateButtons() {
    const hasColors = colors.length > 0;
    btnCopyAll.disabled = !hasColors; btnSaveImg.disabled = !hasColors; btnReset.disabled = !hasColors;
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isCroppingMode) {
      isCroppingMode = false; isDraggingCrop = false;
      canvasWrapper.style.cursor = 'default';
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
    if (e.key === 'Enter' && !isCroppingMode && originalImage && !magnifier.classList.contains('hidden')) {
      const rect = canvasWrapper.getBoundingClientRect();
      const mockEvent = { clientX: targetMagX + rect.left, clientY: targetMagY + rect.top };
      extractColor(getMappedCoords(mockEvent));
    }
    if (e.ctrlKey && e.key === 'z' && colors.length > 0) {
      colors.pop(); renderSlots(); showToast('실행 취소');
    }
  });

  btnCopyAll.addEventListener('click', () => {
    const text = colors.map(c => c.hsbCopy).join('\n');
    navigator.clipboard.writeText(text).then(() => showToast('전체 복사 완료'));
  });

  btnReset.addEventListener('click', () => {
    if (confirm('선택하신 색상을 전부 삭제하시겠습니까?')) { colors = []; renderSlots(); }
  });

  btnSaveImg.addEventListener('click', async () => {
    await document.fonts.ready;
    const expCanvas = document.getElementById('export-canvas');
    const expCtx = expCanvas.getContext('2d');

    const cardW = 240, cardH = 320, padding = 40, gap = 24;

    expCanvas.width = padding * 2 + (cardW * colors.length) + (gap * (colors.length - 1));
    expCanvas.height = padding * 2 + cardH;

    expCtx.fillStyle = '#ffffff';
    expCtx.fillRect(0, 0, expCanvas.width, expCanvas.height);

    colors.forEach((c, i) => {
      const x = padding + (cardW + gap) * i, y = padding;

      expCtx.shadowColor = 'rgba(0,0,0,0.06)';
      expCtx.shadowBlur = 16; expCtx.shadowOffsetX = 6; expCtx.shadowOffsetY = 8;

      expCtx.fillStyle = c.hex;
      expCtx.beginPath();
      expCtx.roundRect(x, y, cardW, cardH * 0.6, [16, 16, 0, 0]);
      expCtx.fill();

      expCtx.shadowColor = 'transparent';

      expCtx.fillStyle = '#ffffff';
      expCtx.beginPath();
      expCtx.roundRect(x, y + cardH * 0.6, cardW, cardH * 0.4, [0, 0, 16, 16]);
      expCtx.fill();

      expCtx.fillStyle = '#171717';
      expCtx.font = 'bold 20px Pretendard, -apple-system, sans-serif';
      expCtx.textAlign = 'center';
      expCtx.fillText(c.hsbDisplay, x + cardW / 2, y + cardH * 0.6 + 55);

      expCtx.fillStyle = '#737373';
      expCtx.font = '500 14px Pretendard, -apple-system, sans-serif';
      expCtx.fillText(`${c.hex} / RGB(${c.r}, ${c.g}, ${c.b})`, x + cardW / 2, y + cardH * 0.6 + 85);
      expCtx.textAlign = 'left';
    });

    const link = document.createElement('a');
    link.download = 'color-palette.png';
    link.href = expCanvas.toDataURL('image/png');
    link.click();
  });

  renderSlots();
});