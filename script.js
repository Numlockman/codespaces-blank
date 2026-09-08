const canvas = document.getElementById("field");
const ctx = canvas.getContext("2d");

const animals = [];

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
  ctx.fillText(`個体数: ${animals.length}`, 10, 22);
}

function loop() {
  update();
  draw();

  requestAnimationFrame(loop);
}

loop();
