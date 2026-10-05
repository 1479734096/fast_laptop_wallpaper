// ========================================================
// 2.5D 交互式动态壁纸核心引擎
// 特性: 
// - 读取工程内的底图，按窗口比例居中铺满
// - 3D 翻转樱花花瓣粒子系统 (多层景深)
// - 环境配色星尘闪烁系统 (四角星芒 + 柔光浮尘)
// - 鼠标/触摸点击交互: 激发生动旋转的花瓣与魔法星光
// - 2.5D 镜头呼吸与空间视差
// - Wallpaper Engine 属性监听与六秒片段录制（目标 60fps）
// ========================================================

const canvas = document.getElementById('wallpaper-canvas');
const ctx = canvas.getContext('2d');

const config = {
  petalCount: 75,
  windSpeed: 1.0,
  sparkleIntensity: 1.2,
  cameraZoom: 1.0,
  parallaxSens: 1.2,
  timeScale: 1.0
};

const defaultEffectTheme = { primaryColor: '#b8d9f2', brightness: 0 };

function isEffectColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function readAutomaticEffectTheme() {
  try {
    const themeNode = document.getElementById('effect-theme');
    if (!themeNode) throw new Error('缺少自动配色数据块');
    const theme = JSON.parse(themeNode.textContent);
    if (!theme || !isEffectColor(theme.primaryColor) || !Number.isFinite(theme.brightness)
        || theme.brightness < 0 || theme.brightness > 1) {
      throw new Error('自动配色数据格式无效');
    }
    return theme;
  } catch (error) {
    console.warn('无法读取自动配色，使用淡蓝色与克制柔光。', error);
    return defaultEffectTheme;
  }
}

function effectColorToRgb(color) {
  return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
}

function createEffectPalette(primaryColor) {
  const channels = effectColorToRgb(primaryColor);
  const tint = amount => channels.map(channel => Math.round(channel + (255 - channel) * amount)).join(', ');
  return { base: tint(0), soft: tint(0.3), light: tint(0.65), highlight: tint(0.9) };
}

function effectRgba(color, alpha) {
  return `rgba(${color}, ${alpha})`;
}

const automaticEffectTheme = readAutomaticEffectTheme();
const ambientGlowScale = 0.35 + 0.65 * automaticEffectTheme.brightness;
let effectPalette = createEffectPalette(automaticEffectTheme.primaryColor);

let mouse = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 };
let screenWidth = window.innerWidth;
let screenHeight = window.innerHeight;
let dpr = window.devicePixelRatio || 1;

// 工程底图载入
const bgImage = new Image();
bgImage.src = 'bg.png';
let bgLoaded = false;
bgImage.onload = () => {
  bgLoaded = true;
};

function resize() {
  screenWidth = window.innerWidth;
  screenHeight = window.innerHeight;
  dpr = window.devicePixelRatio || 1;
  canvas.width = screenWidth * dpr;
  canvas.height = screenHeight * dpr;
  ctx.scale(dpr, dpr);
}
window.addEventListener('resize', resize);
resize();

// 鼠标与触摸视差监听
window.addEventListener('mousemove', (e) => {
  mouse.targetX = e.clientX / screenWidth;
  mouse.targetY = e.clientY / screenHeight;
});

window.addEventListener('touchmove', (e) => {
  if (e.touches.length > 0) {
    mouse.targetX = e.touches[0].clientX / screenWidth;
    mouse.targetY = e.touches[0].clientY / screenHeight;
  }
}, { passive: true });

// 手机陀螺仪倾斜
if (window.DeviceOrientationEvent) {
  window.addEventListener('deviceorientation', (e) => {
    if (e.gamma !== null && e.beta !== null) {
      const g = Math.max(-45, Math.min(45, e.gamma));
      const b = Math.max(-45, Math.min(45, e.beta));
      mouse.targetX = (g + 45) / 90;
      mouse.targetY = (b + 45) / 90;
    }
  });
}

// --------------------------------------------------------
// 1. 樱花花瓣粒子系统 (Sakura Petals)
// --------------------------------------------------------
class SakuraPetal {
  constructor(layer, x = null, y = null, isBurst = false) {
    this.layer = layer; // 0: 远景, 1: 中景, 2: 前景
    this.isBurst = isBurst;
    this.reset(true, x, y);
  }

  reset(initial = false, customX = null, customY = null) {
    if (customX !== null && customY !== null) {
      this.x = customX;
      this.y = customY;
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 5 + 3;
      this.burstVx = Math.cos(angle) * speed;
      this.burstVy = Math.sin(angle) * speed;
    } else {
      this.x = Math.random() * (screenWidth + 240) - 120;
      this.y = initial ? Math.random() * screenHeight : -40 - Math.random() * 60;
      this.burstVx = 0;
      this.burstVy = 0;
    }

    if (this.layer === 0) {
      this.size = Math.random() * 6 + 7;
      this.speedY = (Math.random() * 0.9 + 0.6) * 0.5; // 速度减半
      this.speedX = (Math.random() * 0.7 + 0.5) * 0.5;
      this.opacity = Math.random() * 0.35 + 0.45;
      this.blur = 0;
    } else if (this.layer === 1) {
      this.size = Math.random() * 10 + 11;
      this.speedY = (Math.random() * 1.5 + 1.2) * 0.5; // 速度减半
      this.speedX = (Math.random() * 1.2 + 0.8) * 0.5;
      this.opacity = Math.random() * 0.25 + 0.75;
      this.blur = 0;
    } else {
      this.size = Math.random() * 16 + 20;
      this.speedY = (Math.random() * 2.5 + 2.0) * 0.5; // 速度减半
      this.speedX = (Math.random() * 1.8 + 1.3) * 0.5;
      this.opacity = Math.random() * 0.25 + 0.75;
      this.blur = 1.6;
    }

    this.rotZ = Math.random() * Math.PI * 2;
    this.rotZSpeed = (Math.random() - 0.5) * 0.02; // 自旋减缓
    this.flipAngle = Math.random() * Math.PI * 2;
    this.flipSpeed = (Math.random() * 0.05 + 0.02) * 0.5; // 3D翻转减缓

    this.swingPhase = Math.random() * Math.PI * 2;
    this.swingSpeed = (Math.random() * 0.035 + 0.018) * 0.5; // 左右微风摆动周期放缓
    this.swingAmp = Math.random() * 1.5 + 0.8;
  }

  update(time, windMul) {
    this.swingPhase += this.swingSpeed;
    this.flipAngle += this.flipSpeed;
    this.rotZ += this.rotZSpeed;

    if (this.isBurst) {
      this.x += this.burstVx;
      this.y += this.burstVy;
      this.burstVx *= 0.96;
      this.burstVy *= 0.96;
      this.burstVy += 0.04;
      this.opacity -= 0.008;
      return this.opacity > 0;
    }

    const windX = Math.sin(this.swingPhase) * this.swingAmp + (this.speedX * windMul);
    this.x += windX;
    this.y += this.speedY * (0.8 + windMul * 0.25);

    if (this.y > screenHeight + 50 || this.x > screenWidth + 180) {
      this.reset();
    }
    return true;
  }

  draw(ctx, parallaxOffsetX, parallaxOffsetY) {
    ctx.save();
    const layerFactor = (this.layer + 1) * 0.55;
    const drawX = this.x + parallaxOffsetX * layerFactor;
    const drawY = this.y + parallaxOffsetY * layerFactor;

    ctx.translate(drawX, drawY);
    ctx.rotate(this.rotZ);
    const scaleY = Math.cos(this.flipAngle);
    ctx.scale(1, scaleY);

    if (this.blur > 0) {
      ctx.filter = `blur(${this.blur}px)`;
    }

    // 保留花瓣轮廓，绘制时读取共享色板以立即响应选色。
    ctx.beginPath();
    ctx.moveTo(0, -this.size);
    ctx.bezierCurveTo(this.size * 0.65, -this.size * 0.8, this.size * 0.85, this.size * 0.35, 0, this.size);
    ctx.bezierCurveTo(-this.size * 0.85, this.size * 0.35, -this.size * 0.65, -this.size * 0.8, 0, -this.size);

    const grad = ctx.createLinearGradient(0, -this.size, 0, this.size);
    grad.addColorStop(0, effectRgba(effectPalette.soft, this.opacity));
    grad.addColorStop(0.55, effectRgba(effectPalette.light, this.opacity * 0.96));
    grad.addColorStop(1, effectRgba(effectPalette.base, this.opacity * 0.85));

    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }
}

// --------------------------------------------------------
// 2. 星尘闪烁系统
// --------------------------------------------------------
class MagicSparkle {
  constructor(x = null, y = null, isBurst = false) {
    this.isBurst = isBurst;
    this.reset(true, x, y);
  }

  reset(initial = false, customX = null, customY = null) {
    if (customX !== null && customY !== null) {
      this.x = customX;
      this.y = customY;
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 6 + 2;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.isStar = true;
    } else {
      this.x = Math.random() * screenWidth;
      this.y = initial ? Math.random() * screenHeight : screenHeight + 20;
      this.vx = (Math.random() - 0.5) * 0.4;
      this.vy = -(Math.random() * 0.6 + 0.25);
      this.isStar = Math.random() < 0.45; // 45% 概率为四角星芒，其余为柔光浮尘
    }

    this.radius = Math.random() * 14 + 10;
    this.baseAlpha = Math.random() * 0.18 + 0.08;
    this.pulsePhase = Math.random() * Math.PI * 2;
    this.pulseSpeed = Math.random() * 0.04 + 0.02;
    this.rot = Math.random() * Math.PI * 2;
    this.rotSpeed = (Math.random() - 0.5) * 0.03;
    this.lightVariant = Math.random() < 0.6;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.pulsePhase += this.pulseSpeed;
    this.rot += this.rotSpeed;

    if (this.isBurst) {
      this.vx *= 0.95;
      this.vy *= 0.95;
      this.baseAlpha -= 0.006;
      return this.baseAlpha > 0;
    }

    if (this.y < -30 || this.x < -30 || this.x > screenWidth + 30) {
      this.reset();
    }
    return true;
  }

  draw(ctx, intensity, parallaxOffsetX, parallaxOffsetY) {
    const alpha = Math.max(0, this.baseAlpha * intensity * (0.65 + 0.35 * Math.sin(this.pulsePhase)));
    if (alpha <= 0.001) return;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const drawX = this.x + parallaxOffsetX * 0.35;
    const drawY = this.y + parallaxOffsetY * 0.35;

    ctx.translate(drawX, drawY);
    ctx.rotate(this.rot);
    const sparkleColor = this.lightVariant ? effectPalette.soft : effectPalette.base;

    if (this.isStar) {
      // 绘制精致四角魔法星芒
      ctx.beginPath();
      const rOuter = this.radius * (0.8 + 0.2 * Math.sin(this.pulsePhase));
      const rInner = rOuter * 0.22;
      for (let i = 0; i < 4; i++) {
        const aOuter = (i * Math.PI) / 2;
        const aInner = aOuter + Math.PI / 4;
        if (i === 0) ctx.moveTo(Math.cos(aOuter) * rOuter, Math.sin(aOuter) * rOuter);
        else ctx.lineTo(Math.cos(aOuter) * rOuter, Math.sin(aOuter) * rOuter);
        ctx.lineTo(Math.cos(aInner) * rInner, Math.sin(aInner) * rInner);
      }
      ctx.closePath();

      const starGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, rOuter);
      starGrad.addColorStop(0, effectRgba(effectPalette.highlight, alpha * 2.0));
      starGrad.addColorStop(0.5, effectRgba(sparkleColor, alpha * 1.2));
      starGrad.addColorStop(1, effectRgba(sparkleColor, 0));
      ctx.fillStyle = starGrad;
      ctx.fill();
    } else {
      // 柔和光晕球
      const orbGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, this.radius);
      orbGrad.addColorStop(0, effectRgba(effectPalette.light, alpha * 1.4));
      orbGrad.addColorStop(0.5, effectRgba(sparkleColor, alpha * 0.7));
      orbGrad.addColorStop(1, effectRgba(sparkleColor, 0));
      ctx.fillStyle = orbGrad;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

// 粒子池
let petals = [];
let burstPetals = [];
let sparkles = [];
let burstSparkles = [];

function initPetals() {
  petals = [];
  for (let i = 0; i < config.petalCount; i++) {
    const r = Math.random();
    const layer = r < 0.4 ? 0 : (r < 0.85 ? 1 : 2);
    petals.push(new SakuraPetal(layer));
  }
}
initPetals();

for (let i = 0; i < 28; i++) {
  sparkles.push(new MagicSparkle());
}

// 点击互动：散落花瓣与星尘
window.addEventListener('click', (e) => {
  // 如果点击的是控制面板或按钮，不触发
  if (e.target.closest('#control-panel') || e.target.closest('#toggle-ui-btn')) return;

  const clickX = e.clientX;
  const clickY = e.clientY;

  for (let i = 0; i < 12; i++) {
    burstPetals.push(new SakuraPetal(1, clickX, clickY, true));
  }
  for (let i = 0; i < 16; i++) {
    burstSparkles.push(new MagicSparkle(clickX, clickY, true));
  }
});

// --------------------------------------------------------
// 3. 动画渲染主循环
// --------------------------------------------------------
let startTime = performance.now();

function render(currentTime) {
  const elapsed = (currentTime - startTime) / 1000;

  // 平滑视差插值
  mouse.x += (mouse.targetX - mouse.x) * 0.055;
  mouse.y += (mouse.targetY - mouse.y) * 0.055;

  const normX = (mouse.x - 0.5) * 2;
  const normY = (mouse.y - 0.5) * 2;
  const parallaxX = -normX * 18 * config.parallaxSens;
  const parallaxY = -normY * 18 * config.parallaxSens;

  ctx.clearRect(0, 0, screenWidth, screenHeight);

  if (bgLoaded) {
    ctx.save();

    // 镜头柔和呼吸感 (Harmonic breathing)
    const breathZoom = 1 + Math.sin(elapsed * 0.7) * 0.015 * config.cameraZoom;
    const breathY = Math.cos(elapsed * 0.5) * 6 * config.cameraZoom;

    // 按实际底图比例居中铺满
    const imgAspect = bgImage.naturalWidth / bgImage.naturalHeight;
    const screenAspect = screenWidth / screenHeight;
    let renderW, renderH;

    if (screenAspect > imgAspect) {
      renderW = screenWidth;
      renderH = screenWidth / imgAspect;
    } else {
      renderH = screenHeight;
      renderW = screenHeight * imgAspect;
    }

    renderW *= 1.06 * breathZoom;
    renderH *= 1.06 * breathZoom;

    const drawX = (screenWidth - renderW) / 2 + parallaxX * 0.4;
    const drawY = (screenHeight - renderH) / 2 + parallaxY * 0.4 + breathY;

    // 绘制工程底图
    ctx.drawImage(bgImage, drawX, drawY, renderW, renderH);

    // 深色背景降低柔光叠加，保留原有星尘强度控制。
    if (config.sparkleIntensity > 0) {
      const glowPulse = 0.88 + Math.sin(elapsed * 1.1) * 0.12;
      const ambientGrad = ctx.createRadialGradient(
        screenWidth * 0.6 + parallaxX * 0.2,
        screenHeight * 0.2 + parallaxY * 0.2,
        60,
        screenWidth * 0.6 + parallaxX * 0.2,
        screenHeight * 0.2 + parallaxY * 0.2,
        screenWidth * 0.95
      );
      ambientGrad.addColorStop(0, effectRgba(effectPalette.light, 0.14 * config.sparkleIntensity * glowPulse * ambientGlowScale));
      ambientGrad.addColorStop(0.5, effectRgba(effectPalette.soft, 0.07 * config.sparkleIntensity * glowPulse * ambientGlowScale));
      ambientGrad.addColorStop(1, effectRgba(effectPalette.base, 0));

      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = ambientGrad;
      ctx.fillRect(0, 0, screenWidth, screenHeight);
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.restore();
  }

  // 绘制魔法星尘
  sparkles.forEach(s => {
    s.update();
    s.draw(ctx, config.sparkleIntensity, parallaxX, parallaxY);
  });

  // 绘制点击激发的星尘
  burstSparkles = burstSparkles.filter(s => {
    const alive = s.update();
    if (alive) s.draw(ctx, config.sparkleIntensity, parallaxX, parallaxY);
    return alive;
  });

  // 绘制常规樱花花瓣
  petals.forEach(p => {
    p.update(elapsed, config.windSpeed);
    p.draw(ctx, parallaxX, parallaxY);
  });

  // 绘制点击激发的樱花花瓣
  burstPetals = burstPetals.filter(p => {
    const alive = p.update(elapsed, config.windSpeed);
    if (alive) p.draw(ctx, parallaxX, parallaxY);
    return alive;
  });

  requestAnimationFrame(render);
}

requestAnimationFrame(render);

// --------------------------------------------------------
// 4. 控制台与 UI 交互
// --------------------------------------------------------
const uiToggleBtn = document.getElementById('toggle-ui-btn');
const controlPanel = document.getElementById('control-panel');
const hintBar = document.getElementById('hint-bar');

const effectColorInput = document.getElementById('param-effect-color');
const effectRgbInputs = ['r', 'g', 'b'].map(channel => document.getElementById('param-effect-' + channel));
const effectColorError = document.getElementById('effect-color-error');
const resetEffectColorBtn = document.getElementById('btn-reset-effect-color');
const effectThemeStatus = document.getElementById('effect-theme-status');
const effectStorageKey = 'wallpaper:effect-color:v1:' + window.location.pathname;
let manualEffectColor = null;
let effectStorage = null;
let effectStorageAvailable = true;

try {
  effectStorage = window.localStorage;
  const savedColor = effectStorage.getItem(effectStorageKey);
  if (isEffectColor(savedColor)) {
    manualEffectColor = savedColor.toLowerCase();
  } else if (savedColor !== null) {
    console.warn('已忽略无效的手动特效颜色记录。');
  }
} catch (error) {
  effectStorageAvailable = false;
  console.warn('无法读取特效颜色记录，手动选择仅本次生效。', error);
}

function updateEffectColorControls(sourceInput = null) {
  const color = manualEffectColor || automaticEffectTheme.primaryColor;
  effectPalette = createEffectPalette(color);
  // 输入事件中保留来源控件的草稿与光标，完成编辑后才规范数值显示。
  if (effectColorInput !== sourceInput && effectColorInput.value !== color) {
    effectColorInput.value = color;
  }
  const channels = effectColorToRgb(color);
  effectRgbInputs.forEach((input, index) => {
    const value = String(channels[index]);
    if (input !== sourceInput && input.value !== value) input.value = value;
  });
  resetEffectColorBtn.disabled = manualEffectColor === null;
  effectThemeStatus.textContent = (manualEffectColor ? '手动配色' : '自动配色')
    + (effectStorageAvailable ? '' : ' · 仅本次生效');
}

function persistEffectColor() {
  if (!effectStorageAvailable) return;
  try {
    if (manualEffectColor) {
      effectStorage.setItem(effectStorageKey, manualEffectColor);
    } else {
      effectStorage.removeItem(effectStorageKey);
    }
  } catch (error) {
    effectStorageAvailable = false;
    console.warn('无法保存特效颜色选择，此次调整仅本次生效。', error);
  }
}

function clearEffectColorError() {
  effectColorError.textContent = '';
  effectRgbInputs.forEach(input => input.removeAttribute('aria-invalid'));
}

function applyManualEffectColor(color, sourceInput) {
  const normalizedColor = color.toLowerCase();
  if (manualEffectColor !== normalizedColor) {
    manualEffectColor = normalizedColor;
    persistEffectColor();
  }
  clearEffectColorError();
  updateEffectColorControls(sourceInput);
}

function handleEffectColorInput() {
  if (!isEffectColor(effectColorInput.value)) return;
  applyManualEffectColor(effectColorInput.value, effectColorInput);
}

effectColorInput.addEventListener('input', handleEffectColorInput);
effectColorInput.addEventListener('change', handleEffectColorInput);

function readEffectRgbValue(input) {
  if (!/^\d+$/.test(input.value)) return null;
  const value = Number(input.value);
  return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
}

function finishEffectRgbEdit(input, index) {
  const value = readEffectRgbValue(input);
  if (value === null) {
    const previous = effectColorToRgb(manualEffectColor || automaticEffectTheme.primaryColor)[index];
    input.value = String(previous);
    effectColorError.textContent = ['R', 'G', 'B'][index] + ' 仅支持 0–255 整数，已恢复为 ' + previous + '。';
  } else {
    input.value = String(value);
  }
  input.removeAttribute('aria-invalid');
}

effectRgbInputs.forEach((input, index) => {
  input.addEventListener('input', () => {
    effectColorError.textContent = '';
    const value = readEffectRgbValue(input);
    if (value === null) {
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    const channels = effectColorToRgb(manualEffectColor || automaticEffectTheme.primaryColor);
    channels[index] = value;
    const color = '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');
    applyManualEffectColor(color, input);
  });
  input.addEventListener('blur', () => finishEffectRgbEdit(input, index));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) finishEffectRgbEdit(input, index);
  });
});

resetEffectColorBtn.addEventListener('click', () => {
  manualEffectColor = null;
  persistEffectColor();
  clearEffectColorError();
  updateEffectColorControls();
});

updateEffectColorControls();

uiToggleBtn.addEventListener('click', () => {
  if (controlPanel.classList.contains('active') && effectRgbInputs.includes(document.activeElement)) {
    document.activeElement.blur();
  }
  controlPanel.classList.toggle('active');
  if (hintBar) hintBar.style.opacity = '0';
});

const sliderDisplayUpdates = [];

function bindSlider(id, valId, key, multiplier = 1, suffix = '') {
  const input = document.getElementById(id);
  const valLabel = document.getElementById(valId);
  const updateDisplay = () => {
    const val = config[key];
    input.value = Math.round(val / multiplier);
    valLabel.textContent = (multiplier === 0.1 ? val.toFixed(1) : val) + suffix;
  };
  sliderDisplayUpdates.push(updateDisplay);
  updateDisplay();
  input.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value) * multiplier;
    config[key] = val;
    updateDisplay();
    if (key === 'petalCount') {
      initPetals();
    }
  });
}

bindSlider('param-petal-count', 'val-petal-count', 'petalCount', 1, '');
bindSlider('param-wind-speed', 'val-wind-speed', 'windSpeed', 0.1, 'x');
bindSlider('param-sparkle-intensity', 'val-sparkle-intensity', 'sparkleIntensity', 0.1, 'x');
bindSlider('param-camera-zoom', 'val-camera-zoom', 'cameraZoom', 0.1, 'x');
bindSlider('param-parallax-sens', 'val-parallax-sens', 'parallaxSens', 0.1, 'x');

document.getElementById('btn-fullscreen').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

// 六秒片段录制，不保证首尾无缝衔接。
const btnRecord = document.getElementById('btn-record');
btnRecord.addEventListener('click', () => {
  if (btnRecord.disabled) return;
  btnRecord.disabled = true;
  btnRecord.textContent = '录制中 (6s)...';

  const stream = canvas.captureStream(60);
  let recorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
  } catch (e) {
    recorder = new MediaRecorder(stream);
  }

  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const recordingName = document.documentElement.dataset.projectName || '动态壁纸';
    a.download = recordingName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') + '_6s.webm';
    a.click();
    URL.revokeObjectURL(url);
    btnRecord.disabled = false;
    btnRecord.textContent = '录制 6s 片段';
  };

  recorder.start();
  setTimeout(() => {
    recorder.stop();
  }, 6000);
});

setTimeout(() => {
  if (hintBar) hintBar.style.opacity = '0';
}, 5000);

// --------------------------------------------------------
// 5. Wallpaper Engine 创意工坊属性侦听
// --------------------------------------------------------
window.wallpaperPropertyListener = {
  applyUserProperties: function(properties) {
    if (properties.petalcount) {
      config.petalCount = properties.petalcount.value;
      initPetals();
    }
    if (properties.windspeed) {
      config.windSpeed = properties.windspeed.value / 10;
    }
    if (properties.sparkleintensity) {
      config.sparkleIntensity = properties.sparkleintensity.value / 10;
    }
    // 宿主修改参数后同步网页控件，避免实际值与面板显示分离。
    sliderDisplayUpdates.forEach(updateDisplay => updateDisplay());
  }
};
