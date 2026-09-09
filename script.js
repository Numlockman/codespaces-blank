const canvas = document.getElementById("field");
const ctx = canvas.getContext("2d");

const animals = [];
const grasses = [];

// 草・食事の設定（距離の単位は canvas 上のピクセル）
const INITIAL_GRASS_COUNT = 40;
const MAX_GRASS_COUNT = 200;
const GRASS_SPAWN_CHANCE = 0.08; // 1フレームごとの発生確率
const EAT_HEALTH_THRESHOLD = 70;
const EAT_DISTANCE = 12;
const GRASS_HEALTH_RECOVERY = 30;

function spawnGrass() {
  if (grasses.length >= MAX_GRASS_COUNT) return;

  grasses.push({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height
  });
}

for (let i = 0; i < INITIAL_GRASS_COUNT; i++) {
  spawnGrass();
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

for (let i = 0; i < 10; i++) {
  animals.push({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    speed: 1 + Math.random(),
    angle: Math.random() * Math.PI * 2,
    health: 100,
    maxHealth: 100,
    reproductionCooldown: 0
  });
}

function update() {
  if (Math.random() < GRASS_SPAWN_CHANCE) {
    spawnGrass();
  }

  for (const animal of animals) {
    animal.angle += (Math.random() - 0.5) * 0.3;

    animal.x += Math.cos(animal.angle) * animal.speed;
    animal.y += Math.sin(animal.angle) * animal.speed;

    if (animal.x < 0 || animal.x > canvas.width) {
      animal.angle = Math.PI - animal.angle;
    }

    if (animal.y < 0 || animal.y > canvas.height) {
      animal.angle = -animal.angle;
    }

    animal.x = Math.max(0, Math.min(canvas.width, animal.x));
    animal.y = Math.max(0, Math.min(canvas.height, animal.y));

    animal.health -= 0.05;
    eatNearbyGrass(animal);

    if (animal.reproductionCooldown > 0) {
      animal.reproductionCooldown--;
    }
  }

  for (let i = animals.length - 1; i >= 0; i--) {
    const animal = animals[i];

    if (animal.health <= 0) {
      animals.splice(i, 1);
      continue;
    }

    if (
      animal.health > 70 &&
      animal.reproductionCooldown <= 0 &&
      Math.random() < 0.001
    ) {
      animals.push({
        x: animal.x,
        y: animal.y,
        speed: 1 + Math.random(),
        angle: Math.random() * Math.PI * 2,
        health: 100,
        maxHealth: 100,
        reproductionCooldown: 600
      });

      animal.health -= 30;
      animal.reproductionCooldown = 600;
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 草を先に描き、その上に動物を描く。
  ctx.fillStyle = "#65c74a";
  for (const grass of grasses) {
    ctx.beginPath();
    ctx.arc(grass.x, grass.y, 4, 0, Math.PI * 2);
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

  ctx.fillStyle = "white";
  ctx.font = "16px sans-serif";
  ctx.fillText(`個体数: ${animals.length}  草: ${grasses.length}`, 10, 22);
}

function loop() {
  update();
  draw();

  requestAnimationFrame(loop);
}

loop();
