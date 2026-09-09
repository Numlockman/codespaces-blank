const canvas = document.getElementById("field");
const ctx = canvas.getContext("2d");
const simulationStatus = document.getElementById("simulation-status");

window.addEventListener("error", (event) => {
  if (simulationStatus) {
    simulationStatus.textContent = "エラー: " + event.message;
  }
});

// 操作盤はこの倍率を変更する。1が現在の能力（捕食者の基本速度は1.5倍）。
// 複数の5分試行で共存を確認した初期値。永久的な共存を保証するものではない。
const DEFAULT_SETTINGS = {
  herbivore: { speedMultiplier: 1, reproductionMultiplier: 0.1, energyUseMultiplier: 0.25, detectionDistance: 200 },
  predator: { speedMultiplier: 1, reproductionMultiplier: 0.05, energyUseMultiplier: 0.2, detectionDistance: 80 }
};
const settings = {
  herbivore: { ...DEFAULT_SETTINGS.herbivore },
  predator: { ...DEFAULT_SETTINGS.predator }
};

// 旧コードの60更新/秒を基準に、時間を秒・速度をpx/秒へ換算。
const BASE_UPDATES_PER_SECOND = 60;
const FIXED_DT = 1 / BASE_UPDATES_PER_SECOND;
const MAX_FRAME_SECONDS = 0.1; // 長い停止後の追いつき計算を制限する
const HEALTH_LOSS_PER_SECOND = 6;
const REPRODUCTION_RATE = -Math.log1p(-0.001) * BASE_UPDATES_PER_SECOND;
const REPRODUCTION_COOLDOWN_SECONDS = 10;
const REPRODUCTION_HEALTH_THRESHOLD = 70;
const REPRODUCTION_COST = 30;
let simulationTime = 0;

function eventProbability(rate, dt) {
  return -Math.expm1(-rate * dt);
}

const animals = [];
const predators = [];
const grasses = [];

// 草・食事の設定（距離の単位は canvas 上のピクセル）
const INITIAL_GRASS_COUNT = 120;
const INITIAL_HERBIVORE_COUNT = 40;
const MAX_GRASS_COUNT = 200;
const GRASS_SPAWN_RATE = -Math.log1p(-0.08) * BASE_UPDATES_PER_SECOND;
const GRASS_SPREAD = 30; // 親の草からX・Y方向へ広がる最大距離
const EAT_HEALTH_THRESHOLD = 70;
const EAT_DISTANCE = 12;
const GRASS_HEALTH_RECOVERY = 30;

// 捕食者は草食動物を食べ、空腹時に近くの獲物を追う。
const INITIAL_PREDATOR_COUNT = 2;
const PREDATOR_SPEED_MULTIPLIER = 1.5;

function spawnGrass(randomPosition = false) {
  if (grasses.length >= MAX_GRASS_COUNT) return;

  // 最初の配置だけはフィールド全体から選ぶ。
  if (randomPosition) {
    grasses.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height
    });
    return;
  }

  // 草が全滅したら、新しい草は自然発生しない。
  if (grasses.length === 0) return;

  // 既存の草を親として、その周辺に新しい草を生やす。
  const parent = grasses[Math.floor(Math.random() * grasses.length)];
  const x = parent.x + (Math.random() * 2 - 1) * GRASS_SPREAD;
  const y = parent.y + (Math.random() * 2 - 1) * GRASS_SPREAD;

  grasses.push({
    x: Math.max(0, Math.min(canvas.width, x)),
    y: Math.max(0, Math.min(canvas.height, y))
  });
}



// 空腹の草食動物が探索範囲内の最も近い草を選ぶ。
// 毎更新で現在の草配列を調べるため、食べられた草を追い続けない。
function findNearbyGrass(animal) {
  if (animal.health <= 0 || animal.health > EAT_HEALTH_THRESHOLD) return null;
  let nearest = null;
  let nearestSquared = settings.herbivore.detectionDistance ** 2;
  for (const grass of grasses) {
    const dx = grass.x - animal.x;
    const dy = grass.y - animal.y;
    const squared = dx * dx + dy * dy;
    if (squared <= nearestSquared) {
      nearest = grass;
      nearestSquared = squared;
    }
  }
  return nearest;
}

// 空腹で近くにあるときだけ食べる。1フレームにつき1株まで。
function eatNearbyGrass(animal) {
  if (animal.health <= 0 || animal.health > EAT_HEALTH_THRESHOLD) return;

  for (let i = 0; i < grasses.length; i++) {
    const distance = Math.hypot(
      animal.x - grasses[i].x,
      animal.y - grasses[i].y
    );

    if (distance <= EAT_DISTANCE) {
      animal.health = Math.min(
        animal.maxHealth,
        animal.health + GRASS_HEALTH_RECOVERY
      );
      grasses.splice(i, 1);
      return;
    }
  }
}

// 平方根や配列の作成を避け、範囲内で最も近い生きた獲物を探す。
function findNearbyPrey(predator) {
  if (predator.health <= 0 || predator.health > EAT_HEALTH_THRESHOLD) return null;

  let target = null;
  let nearestDistanceSquared = settings.predator.detectionDistance ** 2;
  for (const animal of animals) {
    if (animal.health <= 0) continue;
    const dx = animal.x - predator.x;
    const dy = animal.y - predator.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared <= nearestDistanceSquared) {
      target = animal;
      nearestDistanceSquared = distanceSquared;
    }
  }
  return target;
}

// 空腹の捕食者が近くの草食動物を1匹だけ食べる。
function eatNearbyAnimal(predator) {
  if (predator.health <= 0 || predator.health > EAT_HEALTH_THRESHOLD) return;

  for (let i = 0; i < animals.length; i++) {
    const distance = Math.hypot(
      predator.x - animals[i].x,
      predator.y - animals[i].y
    );

    if (distance <= EAT_DISTANCE) {
      predator.health = Math.min(
        predator.maxHealth,
        predator.health + GRASS_HEALTH_RECOVERY
      );
      animals.splice(i, 1);
      return;
    }
  }
}

function initializePopulations() {
  animals.length = 0;
  predators.length = 0;
  grasses.length = 0;
  for (let i = 0; i < INITIAL_GRASS_COUNT; i++) spawnGrass(true);
for (let i = 0; i < INITIAL_HERBIVORE_COUNT; i++) {
  animals.push({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    speed: (1 + Math.random()) * BASE_UPDATES_PER_SECOND,
    angle: Math.random() * Math.PI * 2,
    health: 100,
    maxHealth: 100,
    reproductionCooldown: 0
  });
}

for (let i = 0; i < INITIAL_PREDATOR_COUNT; i++) {
  predators.push({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    speed: (1 + Math.random()) * PREDATOR_SPEED_MULTIPLIER * BASE_UPDATES_PER_SECOND,
    angle: Math.random() * Math.PI * 2,
    health: 100,
    maxHealth: 100,
    reproductionCooldown: 0
  });
}


}
initializePopulations();

// dtは固定の1/60秒。ランダムな方向変更もこの間隔で行う。
function update(dt = FIXED_DT) {
  simulationTime += dt;
  if (Math.random() < eventProbability(GRASS_SPAWN_RATE, dt)) {
    spawnGrass();
  }

  for (const animal of animals) {
    const grass = findNearbyGrass(animal);
    if (grass) {
      animal.angle = Math.atan2(grass.y - animal.y, grass.x - animal.x);
    } else {
      animal.angle += (Math.random() - 0.5) * 0.3;
    }

    const speed = animal.speed * settings.herbivore.speedMultiplier;
    animal.x += Math.cos(animal.angle) * speed * dt;
    animal.y += Math.sin(animal.angle) * speed * dt;

    if (animal.x < 0 || animal.x > canvas.width) {
      animal.angle = Math.PI - animal.angle;
    }

    if (animal.y < 0 || animal.y > canvas.height) {
      animal.angle = -animal.angle;
    }

    animal.x = Math.max(0, Math.min(canvas.width, animal.x));
    animal.y = Math.max(0, Math.min(canvas.height, animal.y));

    animal.health -= HEALTH_LOSS_PER_SECOND * settings.herbivore.energyUseMultiplier * dt;
    eatNearbyGrass(animal);

    if (animal.reproductionCooldown > 0) {
      animal.reproductionCooldown = Math.max(0, animal.reproductionCooldown - dt);
      if (animal.reproductionCooldown < 1e-9) animal.reproductionCooldown = 0;
    }
  }

  for (let i = animals.length - 1; i >= 0; i--) {
    const animal = animals[i];

    if (animal.health <= 0) {
      animals.splice(i, 1);
      continue;
    }

    if (
      animal.health > REPRODUCTION_HEALTH_THRESHOLD &&
      animal.reproductionCooldown <= 0 &&
      Math.random() < eventProbability(REPRODUCTION_RATE * settings.herbivore.reproductionMultiplier, dt)
    ) {
      animals.push({
        x: animal.x,
        y: animal.y,
        speed: (1 + Math.random()) * BASE_UPDATES_PER_SECOND,
        angle: Math.random() * Math.PI * 2,
        health: 100,
        maxHealth: 100,
        reproductionCooldown: REPRODUCTION_COOLDOWN_SECONDS
      });

      animal.health -= REPRODUCTION_COST;
      animal.reproductionCooldown = REPRODUCTION_COOLDOWN_SECONDS;
    }
  }

  for (const predator of predators) {
    const prey = findNearbyPrey(predator);
    if (prey) {
      predator.angle = Math.atan2(prey.y - predator.y, prey.x - predator.x);
    } else {
      predator.angle += (Math.random() - 0.5) * 0.3;
    }

    const speed = predator.speed * settings.predator.speedMultiplier;
    predator.x += Math.cos(predator.angle) * speed * dt;
    predator.y += Math.sin(predator.angle) * speed * dt;

    if (predator.x < 0 || predator.x > canvas.width) {
      predator.angle = Math.PI - predator.angle;
    }
    if (predator.y < 0 || predator.y > canvas.height) {
      predator.angle = -predator.angle;
    }

    predator.x = Math.max(0, Math.min(canvas.width, predator.x));
    predator.y = Math.max(0, Math.min(canvas.height, predator.y));

    predator.health -= HEALTH_LOSS_PER_SECOND * settings.predator.energyUseMultiplier * dt;
    eatNearbyAnimal(predator);

    if (predator.reproductionCooldown > 0) {
      predator.reproductionCooldown = Math.max(0, predator.reproductionCooldown - dt);
      if (predator.reproductionCooldown < 1e-9) predator.reproductionCooldown = 0;
    }
  }

  for (let i = predators.length - 1; i >= 0; i--) {
    const predator = predators[i];

    if (predator.health <= 0) {
      predators.splice(i, 1);
      continue;
    }

    if (
      predator.health > REPRODUCTION_HEALTH_THRESHOLD &&
      predator.reproductionCooldown <= 0 &&
      Math.random() < eventProbability(REPRODUCTION_RATE * settings.predator.reproductionMultiplier, dt)
    ) {
      predators.push({
        x: predator.x,
        y: predator.y,
        speed: (1 + Math.random()) * PREDATOR_SPEED_MULTIPLIER * BASE_UPDATES_PER_SECOND,
        angle: Math.random() * Math.PI * 2,
        health: 100,
        maxHealth: 100,
        reproductionCooldown: REPRODUCTION_COOLDOWN_SECONDS
      });

      predator.health -= REPRODUCTION_COST;
      predator.reproductionCooldown = REPRODUCTION_COOLDOWN_SECONDS;
    }
  }
  updateComparison(dt);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 草を先に描き、その上に動物を描く。
  // 明るい緑のフィールドでも見えるよう、濃い緑の3本の葉で表す。
  ctx.strokeStyle = "#075d24";
  ctx.fillStyle = "#075d24";
  ctx.lineWidth = 2;
  for (const grass of grasses) {
    ctx.beginPath();
    ctx.moveTo(grass.x, grass.y + 4);
    ctx.lineTo(grass.x - 4, grass.y - 4);
    ctx.moveTo(grass.x, grass.y + 4);
    ctx.lineTo(grass.x, grass.y - 6);
    ctx.moveTo(grass.x, grass.y + 4);
    ctx.lineTo(grass.x + 4, grass.y - 4);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(grass.x, grass.y + 4, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const animal of animals) {
    ctx.beginPath();
    ctx.arc(animal.x, animal.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();

    ctx.fillStyle = "black";
    ctx.fillRect(animal.x - 10, animal.y - 14, 20, 3);

    const healthRate = animal.health / animal.maxHealth;

    ctx.fillStyle = "lime";
    ctx.fillRect(animal.x - 10, animal.y - 14, 20 * healthRate, 3);
  }

  // 捕食者は赤い丸で表示する。
  for (const predator of predators) {
    ctx.beginPath();
    ctx.arc(predator.x, predator.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = "red";
    ctx.fill();

    ctx.fillStyle = "black";
    ctx.fillRect(predator.x - 10, predator.y - 15, 20, 3);

    const healthRate = predator.health / predator.maxHealth;

    ctx.fillStyle = "lime";
    ctx.fillRect(predator.x - 10, predator.y - 15, 20 * healthRate, 3);
  }

  ctx.fillStyle = "white";
  ctx.font = "16px sans-serif";
  ctx.fillText(
    `草食動物: ${animals.length}  捕食者: ${predators.length}  草: ${grasses.length}`,
    10,
    20
  );
}

let lastTimestamp = null;
let accumulatedTime = 0;
let simulationSpeed = 1;

// 非表示の間は進めず、戻った際にまとめて計算しない。
document.addEventListener("visibilitychange", () => {
  lastTimestamp = null;
  accumulatedTime = 0;
});

function loop(timestamp) {
  if (document.hidden) {
    lastTimestamp = null;
    accumulatedTime = 0;
  } else {
    if (lastTimestamp !== null) {
      accumulatedTime += Math.min(
        MAX_FRAME_SECONDS,
        Math.max(0, (timestamp - lastTimestamp) / 1000)
      ) * simulationSpeed;
    }
    lastTimestamp = timestamp;
    while (accumulatedTime + 1e-9 >= FIXED_DT) {
      update(FIXED_DT);
      accumulatedTime = Math.max(0, accumulatedTime - FIXED_DT);
    }
    draw();
  }
  requestAnimationFrame(loop);
}

draw();
if (simulationStatus) {
  simulationStatus.textContent = "実行中";
}
requestAnimationFrame(loop);

// 操作盤から設定だけを更新し、個体固有の基準速度は変更しない。
const settingInputs = document.querySelectorAll("input[data-species][data-setting]");
function refreshSettingInput(input) {
  const value = settings[input.dataset.species][input.dataset.setting];
  input.value = value;
  const distance = input.dataset.setting === "detectionDistance";
  const text = distance ? value + "px" : value.toFixed(2) + "倍";
  const output = document.getElementById(input.id + "-value");
  if (output) output.textContent = text;
  input.setAttribute("aria-valuetext", text);
}
for (const input of settingInputs) {
  refreshSettingInput(input);
  input.addEventListener("input", () => {
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    settings[input.dataset.species][input.dataset.setting] =
      Math.max(Number(input.min), Math.min(Number(input.max), value));
    refreshSettingInput(input);
  });
}
const resetSettingsButton = document.getElementById("reset-settings");
if (resetSettingsButton) {
  resetSettingsButton.addEventListener("click", () => {
    for (const species of ["herbivore", "predator"]) {
      Object.assign(settings[species], DEFAULT_SETTINGS[species]);
    }
    for (const input of settingInputs) refreshSettingInput(input);
    const status = document.getElementById("settings-status");
    if (status) status.textContent = "倍率・探索距離を初期値に戻しました。";
  });
}

// 比較グラフ：箱庭と同じ固定時間刻みで方程式を積分する。
const DEFAULT_LV_COEFFICIENTS = { alpha: 0.06, beta: 0.02, delta: 0.01, gamma: 0.12 };
const lv = { ...DEFAULT_LV_COEFFICIENTS,
  x: animals.length, y: predators.length, valid: true };
const populationHistory = [];
const MAX_HISTORY_POINTS = 601;
let nextPopulationSample = simulationTime + 1;
const graphCanvas = document.getElementById("population-graph");
const graphContext = graphCanvas ? graphCanvas.getContext("2d") : null;

function lvDerivative(x, y) {
  return [lv.alpha*x-lv.beta*x*y, lv.delta*x*y-lv.gamma*y];
}
function stepEquation(dt) {
  if (!lv.valid) return;
  const x=lv.x, y=lv.y;
  const a=lvDerivative(x,y);
  const b=lvDerivative(x+a[0]*dt/2,y+a[1]*dt/2);
  const c=lvDerivative(x+b[0]*dt/2,y+b[1]*dt/2);
  const d=lvDerivative(x+c[0]*dt,y+c[1]*dt);
  const nx=x+dt*(a[0]+2*b[0]+2*c[0]+d[0])/6;
  const ny=y+dt*(a[1]+2*b[1]+2*c[1]+d[1])/6;
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx<0 || ny<0 || nx>1e7 || ny>1e7) {
    lv.valid=false;
    const status=document.getElementById("graph-status");
    if(status) status.textContent="方程式の計算範囲を超えました。係数を小さくして比較し直してください。箱庭は継続します。";
    return;
  }
  lv.x=nx;lv.y=ny;
}
function recordPopulation(time) {
  populationHistory.push({time, herbivore:animals.length, predator:predators.length,
    theoryHerbivore:lv.valid?lv.x:null, theoryPredator:lv.valid?lv.y:null});
  if(populationHistory.length>MAX_HISTORY_POINTS) populationHistory.shift();
}
function updateComparison(dt) {
  stepEquation(dt);
  if(simulationTime+1e-9>=nextPopulationSample) {
    recordPopulation(nextPopulationSample);
    nextPopulationSample+=1;
    drawPopulationGraph();
  }
}
function drawPopulationGraph() {
  if(!graphContext || !populationHistory.length) return;
  const box=graphCanvas.parentElement.getBoundingClientRect();
  const w=Math.max(240,Math.floor(box.width)),h=Math.max(120,Math.floor(box.height));
  const ratio=Math.min(window.devicePixelRatio||1,2);
  graphCanvas.width=Math.round(w*ratio);graphCanvas.height=Math.round(h*ratio);
  const g=graphContext;g.setTransform(ratio,0,0,ratio,0,0);
  const left=52,right=w-16,top=22,bottom=h-32;
  const first=populationHistory[0].time,last=populationHistory[populationHistory.length-1].time;
  const end=Math.max(first+10,last);
  let peak=1;
  for(const row of populationHistory) for(const key of ["herbivore","predator","theoryHerbivore","theoryPredator"]) {
    if(row[key]!==null) peak=Math.max(peak,row[key]);
  }
  const ceiling=Math.max(5,Math.ceil(peak*1.1));
  const px=t=>left+(t-first)/(end-first)*(right-left);
  const py=n=>bottom-n/ceiling*(bottom-top);
  g.font="12px system-ui";g.fillStyle="#502034";g.fillText("個体数",4,14);
  g.lineWidth=1;g.strokeStyle="#d8c3cb";
  for(let i=0;i<=2;i++){
    const n=ceiling*i/2,y=py(n);g.beginPath();g.moveTo(left,y);g.lineTo(right,y);g.stroke();
    g.textAlign="right";g.fillText(n.toFixed(n%1?1:0),left-6,y+4);
  }
  const ticks=w<450?2:4;
  for(let i=0;i<=ticks;i++){
    const t=first+(end-first)*i/ticks;
    g.textAlign=i===0?"left":i===ticks?"right":"center";
    g.fillText(t.toFixed(0),px(t),bottom+16);
  }
  g.textAlign="right";g.fillText("シミュレーション時間（秒）",right,h-2);
  g.save();g.beginPath();g.rect(left,top,right-left,bottom-top);g.clip();
  for(const [key,color,dashed] of [
    ["herbivore","#145cc5",false],["predator","#c02b3a",false],
    ["theoryHerbivore","#145cc5",true],["theoryPredator","#c02b3a",true]]) {
    g.strokeStyle=color;g.fillStyle=color;g.lineWidth=2;g.setLineDash(dashed?[6,4]:[]);
    g.beginPath();let started=false;
    for(const row of populationHistory){
      if(row[key]===null){started=false;continue;}
      if(!started){g.moveTo(px(row.time),py(row[key]));started=true;}
      else g.lineTo(px(row.time),py(row[key]));
    }
    g.stroke();
    const row=populationHistory[populationHistory.length-1];
    if(row[key]!==null){g.beginPath();g.arc(px(row.time),py(row[key]),2,0,2*Math.PI);g.fill();}
  }
  g.restore();g.setLineDash([]);
  const timeLabel=document.getElementById("graph-time");
  if(timeLabel)timeLabel.textContent=last.toFixed(0)+"秒 ／ 直近600秒";
}
const restartComparison=document.getElementById("restart-comparison");
if(restartComparison)restartComparison.addEventListener("click",()=>{
  const coefficients={};
  for(const key of ["alpha","beta","delta","gamma"]){
    const input=document.getElementById("lv-"+key);
    const value=Number(input.value);
    if(input.value.trim()==="" || !Number.isFinite(value) || value<0 || value>1){
      document.getElementById("graph-status").textContent="係数は0〜1の数値を入力してください。";
      return;
    }
    coefficients[key]=value;
  }
  Object.assign(lv,coefficients,{x:animals.length,y:predators.length,valid:true});
  populationHistory.length=0;
  recordPopulation(simulationTime);nextPopulationSample=simulationTime+1;
  document.getElementById("graph-status").textContent="現在の個体数から比較を開始。係数は箱庭の倍率と独立です。";
  drawPopulationGraph();
});
recordPopulation(simulationTime);
if(graphCanvas && typeof ResizeObserver!=="undefined"){
  new ResizeObserver(drawPopulationGraph).observe(graphCanvas.parentElement);
} else {
  window.addEventListener("resize", drawPopulationGraph);
}
drawPopulationGraph();

function restartSimulation() {
  initializePopulations();
  simulationTime = 0;
  lastTimestamp = null;
  accumulatedTime = 0;
  lv.x = animals.length;
  lv.y = predators.length;
  lv.valid = true;
  populationHistory.length = 0;
  nextPopulationSample = 1;
  recordPopulation(0);
  draw();
  drawPopulationGraph();
  if (simulationStatus) simulationStatus.textContent = "実行中";
  const status = document.getElementById("graph-status");
  if (status) status.textContent = "現在の設定で再スタート。方程式の係数は箱庭と独立です。";
}
const restartButton = document.getElementById("restart-simulation");
if (restartButton) restartButton.addEventListener("click", restartSimulation);

const speedButtons = document.querySelectorAll("button[data-simulation-speed]");
for (const button of speedButtons) {
  button.addEventListener("click", () => {
    const speed = Number(button.dataset.simulationSpeed);
    if (![1, 3, 5].includes(speed)) return;
    simulationSpeed = speed;
    // 変更前の端数を新しい倍率に持ち越さない。
    lastTimestamp = null;
    accumulatedTime = 0;
    for (const candidate of speedButtons) {
      candidate.setAttribute("aria-pressed",
        String(Number(candidate.dataset.simulationSpeed) === simulationSpeed));
    }
  });
}

function resetAll() {
  for (const species of ["herbivore", "predator"]) {
    Object.assign(settings[species], DEFAULT_SETTINGS[species]);
  }
  for (const input of settingInputs) refreshSettingInput(input);
  const coefficients = DEFAULT_LV_COEFFICIENTS;
  Object.assign(lv, coefficients);
  for (const [key, value] of Object.entries(coefficients)) {
    const input = document.getElementById("lv-" + key);
    if (input) input.value = value;
  }
  simulationSpeed = 1;
  for (const button of speedButtons) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.simulationSpeed) === 1));
  }
  restartSimulation();
  const status = document.getElementById("settings-status");
  if (status) status.textContent = "全リセットしました（速度×1）。";
}
const resetAllButton = document.getElementById("reset-all");
if (resetAllButton) resetAllButton.addEventListener("click", resetAll);
