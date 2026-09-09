const canvas = document.getElementById("field");
const ctx = canvas.getContext("2d");
const simulationStatus = document.getElementById("simulation-status");

window.addEventListener("error", (event) => {
  if (simulationStatus) {
    simulationStatus.textContent = "エラー: " + event.message;
  }
});

// 操作盤はこの倍率を変更する。1が現在の能力（捕食者の基本速度は1.5倍）。
const settings = {
  herbivore: { speedMultiplier: 1, reproductionMultiplier: 1, energyUseMultiplier: 1 },
  predator: { speedMultiplier: 1, reproductionMultiplier: 1, energyUseMultiplier: 1, detectionDistance: 120 }
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
const INITIAL_GRASS_COUNT = 40;
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

for (let i = 0; i < INITIAL_GRASS_COUNT; i++) {
  spawnGrass(true);
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

for (let i = 0; i < 10; i++) {
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

// dtは固定の1/60秒。ランダムな方向変更もこの間隔で行う。
function update(dt = FIXED_DT) {
  simulationTime += dt;
  if (Math.random() < eventProbability(GRASS_SPAWN_RATE, dt)) {
    spawnGrass();
  }

  for (const animal of animals) {
    animal.angle += (Math.random() - 0.5) * 0.3;

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
      );
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
  const text = distance ? value + "px" : value.toFixed(1) + "倍";
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
      settings[species].speedMultiplier = 1;
      settings[species].reproductionMultiplier = 1;
      settings[species].energyUseMultiplier = 1;
    }
    settings.predator.detectionDistance = 120;
    for (const input of settingInputs) refreshSettingInput(input);
    const status = document.getElementById("settings-status");
    if (status) status.textContent = "倍率・探索距離を初期値に戻しました。";
  });
}
