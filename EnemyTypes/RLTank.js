import { Bullet } from "../BulletTypes/Bullet.js";
export class RLTank {

    static sharedModel = null;

    constructor(x, y, width, height, speed) {
        this.body = PIXI.Sprite.from(PIXI.Texture.WHITE);
        this.body.tint = 0xff0000;

        this.setPosition(x, y);
        this.setSize(width, height);

        this.firedBullets = 0;
        this.speed = speed;

        this.recoilAnimationTime = 0;
        this.cooldownPeriod = 5;

        this.maxBullets = 5;

        this.shotDelayAccumulator = 0;
        this.shotDelay = 0;

        this.targetDestination = null;

        this.turret = new PIXI.Graphics();
        this.turret.beginFill(0x965d00);
        this.turret.drawRect(0, -2, 20, 4);
        this.turret.endFill();
        this.turret.x = this.body.width / 2 - this.turret.height / 2;
        this.turret.y = this.body.height / 2 - this.turret.height / 2;

        this.body.addChild(this.turret);

        this.alive = true;

        this.epsilon = 1.0;  // Start with full exploration
        this.epsilonDecay = 0.9995;  // Decay factor per episode or step
        this.minEpsilon = 0.01;  // Minimum epsilon value

        this.lastAction = "none";

        this.isTraining = false;

        this.hitEnemy = false;
        this.gotHit = false;

        this.framesAlive = 0;

        this.outputSize = 8;

        this.velocityX = 0;
        this.velocityY = 0;
        this.movementAngle = 0;

        if (!RLTank.sharedModel) {
            RLTank.sharedModel = this.createModel();  // Create model only once
        }
        this.model = RLTank.sharedModel;
    }

    isAlive() {
        return this.isAlive;
    }

    setAlive(alive) {
        this.alive = alive;
    }

    setPosition(x, y) {
        this.body.x = x;
        this.body.y = y;
    }

    setSize(width, height) {
        this.body.width = width;
        this.body.height = height;
    }

    rotateTurret(targetX, targetY) {
        const turretBaseWorldX = this.body.x + this.body.width / 2;
        const turretBaseWorldY = this.body.y + this.body.height / 2;

        const dx = targetX - turretBaseWorldX;
        const dy = targetY - turretBaseWorldY;
        const angle = Math.atan2(dy, dx);

        this.turret.rotation = angle;
    }

    setPathfinder() {
        // Does nothing
    }

    fireBullet() {
        // Limit the amount of bullets that tanks can fire
        if (this.firedBullets < this.maxBullets) {
            const angle = this.turret.rotation;

            // Calculate the starting position at the tip of the turret
            const startX = this.body.x + this.turret.x + Math.cos(angle) * 25;
            const startY = this.body.y + this.turret.y + Math.sin(angle) * 25;

            const bullet = new Bullet(this, startX, startY);
            bullet.fire(angle)

            this.firedBullets += 1;
            this.recoilAnimationTime = this.cooldownPeriod;
            return bullet;
        }
        return null;
    }

    isWallOrHole(cell) {
        return cell.getCellType() === 'wall' || cell.getCellType() === 'hole';
    }

    async setHitEnemy(flag) {
        this.hitEnemy = flag;
    }

    setGotHit(flag) {
        this.gotHit = flag;
    }

    createModel() {
        if (RLTank.sharedModel) {
            return RLTank.sharedModel;
        }

        console.log("Model Initialized");

        // CNN for Grid Data
        // size 1200
        const gridInput = tf.input({ shape: [30, 40, 1] }); // Adjust the shape based on your grid representation
        let cnn = tf.layers.conv2d({ filters: 64, kernelSize: [3, 3], activation: 'relu' }).apply(gridInput);
        cnn = tf.layers.maxPooling2d({ poolSize: [2, 2] }).apply(cnn);
        cnn = tf.layers.conv2d({ filters: 128, kernelSize: [3, 3], activation: 'relu' }).apply(cnn);
        cnn = tf.layers.maxPooling2d({ poolSize: [2, 2] }).apply(cnn);
        cnn = tf.layers.flatten().apply(cnn);

        // Input for Tank and Bullet Data
        // (x, y) coords for each
        // velocity (x, y) and angle for each
        // Max of 8 tanks at once
        // Max of 5 bullets per tank
        // 8 * 5 + 5 * 5 = size 65
        const tankBulletInput = tf.input({ shape: [65] });

        // Combine CNN and Tank/Bullet Data
        const combinedInput = tf.layers.concatenate().apply([cnn, tankBulletInput]);

        // Dense Layers after combining
        let network = tf.layers.dense({ units: 256, activation: 'relu' }).apply(combinedInput);
        network = tf.layers.dropout({ rate: 0.2 }).apply(network); // 20% dropout
        network = tf.layers.dense({ units: 128, activation: 'relu' }).apply(network);
        const output = tf.layers.dense({ units: this.outputSize, activation: 'linear' }).apply(network); // 16 units for 16 actions

        // Create and Compile Model
        const model = tf.model({ inputs: [gridInput, tankBulletInput], outputs: output });
        model.compile({ optimizer: tf.train.adam(0.001), loss: tf.losses.huberLoss });

        this.model = model;

        return model;
    }

    decideAction(mapData, tankBulletData, epsilon) {
        // Decide on random action based on epsilon
        if (Math.random() < epsilon) {
            return Math.floor(Math.random() * this.outputSize);
        }

        // Prepare tensors for prediction
        const gridTensor = tf.tensor([mapData], [1, 30, 40, 1]); // Shape as [batch, height, width, channels]
        const tankBulletTensor = tf.tensor([tankBulletData], [1, 65]); // Shape as [batch, features]

        // Predict Q-values using the model
        const qValues = this.model.predict([gridTensor, tankBulletTensor]).arraySync()[0];

        // Choose the action with the highest Q-value
        const maxQValueIndex = qValues.indexOf(Math.max(...qValues));
        return maxQValueIndex;
    }


    performAction(maxQValueIndex, delta) {
        let moveToX = this.body.x + this.body.width / 2;
        let moveToY = this.body.y + this.body.height / 2;
        let targetX = this.body.x + this.body.width / 2;
        let targetY = this.body.y + this.body.height / 2;
        let wantToShoot = false;

        switch (maxQValueIndex) {
            // Move up
            case 0:
                moveToY -= 1;
                break;

            // Move down
            case 1:
                moveToY += 1;
                break;

            // Move left
            case 2:
                moveToX -= 1;
                break;

            // Move right
            case 3:
                moveToX += 1;
                break;

            // Move top left
            case 4:
                moveToY -= 1;
                moveToX -= 1;
                break;

            // Move top right
            case 5:
                moveToY -= 1;
                moveToX += 1;
                break;

            // Move bottom left
            case 6:
                moveToY += 1;
                moveToX -= 1;
                break;

            // Move bottom right
            case 7:
                moveToY += 1;
                moveToX += 1;
                break;

            // Shoot up
            // I add 0.00001 cause there's a bug with the bullet cross product calculations
            case 8:
                targetY -= 5;
                targetX -= 0.00001;
                break;

            // Shoot down
            case 9:
                targetY += 5;
                targetX -= 0.00001;
                break;

            // Shoot left
            case 10:
                targetX -= 5;
                targetY -= 0.00001;
                break;

            // Shoot right
            case 11:
                targetX += 5;
                targetY -= 0.00001;
                break;

            // Shoot top left
            case 12:
                targetY -= 1;
                targetX -= 1;
                break;

            // Shoot top right
            case 13:
                targetY -= 1;
                targetX += 1;
                break;

            // Shoot bottom left
            case 14:
                targetY += 1;
                targetX -= 1;
                break;

            // Shoot bottom right
            case 15:
                targetY += 1;
                targetX += 1;
                break;
        }

        // If NN wants to shoot
        if (maxQValueIndex >= 8) {
            wantToShoot = true;
            this.lastAction = "shoot";
        }

        // If NN wants to move
        if (maxQValueIndex < 8) {
            let directionX = moveToX - (this.body.x + this.body.width / 2);
            let directionY = moveToY - (this.body.y + this.body.height / 2);

            let magnitude = Math.sqrt(directionX * directionX + directionY * directionY);
            if (magnitude != 0) {
                directionX /= magnitude;
                directionY /= magnitude;
            }

            this.body.x += directionX * this.speed * delta;
            this.body.y += directionY * this.speed * delta;

            this.lastAction = "move";
        }

        return [targetX, targetY, wantToShoot]
    }

    // Min-max normalization
    normalize(data) {
        const max = Math.max(...data);
        const min = Math.min(...data);
        return data.map(value => (value - min) / (max - min));
    }

    createState(mapWalls, allBullets, myTeam, enemyTeam, mapWidth = 800, mapHeight = 600) {
        let flatGrid = mapWalls.flat();
        let mapData = [];

        // Process map data
        for (let i = 0; i < flatGrid.length; i++) {
            mapData.push(flatGrid[i].getCellType() === 'wall' ? 1 : 0);
        }

        // Function to normalize coordinates
        const normalizeCoord = (value, max) => value / max;

        // Function to normalize angles (-π to π to [0, 1])
        const normalizeAngle = angle => (angle + Math.PI) / (2 * Math.PI);

        // Process bullet data with separate normalization for coordinates and angles
        let bulletData = allBullets.flat().map(bullet => [
            normalizeCoord(bullet.body.x + bullet.body.width / 2, mapWidth),
            normalizeCoord(bullet.body.y + bullet.body.height / 2, mapHeight),
            bullet.velocityX,  // Assuming velocity does not need normalization
            bullet.velocityY,  // Assuming velocity does not need normalization
            normalizeAngle(bullet.angle)
        ]).flat();

        // Process tank data with separate normalization for coordinates and angles
        let tankData = [];
        myTeam.flat().concat(enemyTeam.flat()).forEach(tank => {
            const data = [
                normalizeCoord(tank.body.x + tank.body.width / 2, mapWidth),
                normalizeCoord(tank.body.y + tank.body.height / 2, mapHeight),
                tank.velocityX,  // Assuming velocity does not need normalization
                tank.velocityY,  // Assuming velocity does not need normalization
                normalizeAngle(tank.movementAngle)
            ];
            if (tank === this) {
                tankData = data.concat(tankData);  // Prepend this tank's data
            } else {
                tankData = tankData.concat(data);  // Append other tanks' data
            }
        });

        // Pad the tank data to ensure consistency in input size
        const totalLength = 65;  // Ensure this matches the expected input size for your model
        while (tankData.length + bulletData.length < totalLength) {
            tankData.push(-1);  // Add padding
        }

        return [mapData, bulletData.concat(tankData)];
    }

    calculateReward() {
        let reward = this.framesAlive * 0.5;

        // Check if the agent hit an enemy tank
        // Note that this is not triggers if it shoots itself
        if (this.hitEnemy) {
            reward += 100;  // Add a large reward for hitting an enemy
            this.hitEnemy = false;  // Reset the flag
        }

        // Check if the agent was hit by an enemy
        if (this.gotHit) {
            reward -= 50;  // Penalize getting hit
            this.gotHit = false;  // Reset the flag
        }

        if (this.gotHitBySelf) {
            reward -= 100;
            this.gotHitBySelf = false;
        }

        // Consider the cost of firing a bullet
        if (this.lastAction === 'shoot') {
            reward -= 1;  // Small penalty to discourage shooting too often without purpose
        }

        // Additional rewards/penalties could be added here based on other game dynamics
        // For example, moving closer to an enemy or avoiding a bullet could be slightly rewarded
        return reward;
    }

    update(delta, mapWalls, player, collisionLines, allBullets, myTeam, enemyTeam, replayBuffer, stepCount) {
        this.replayBuffer = replayBuffer;
        this.framesAlive += 1;
        this.model = RLTank.sharedModel;

        let res = [];
        let canShoot = false;
        let startedTraining = false;

        this.wallPathChangeTimeAccumulator += delta;
        this.shotDelayAccumulator += delta;
        if (this.shotDelayAccumulator > this.shotDelay) {
            canShoot = true;
            this.shotDelayAccumulator = 0;
            this.shotDelay = 0;
        }

        // Store the previous position before movement
        let prevX = this.body.x;
        let prevY = this.body.y;

        // RL Learning Steps
        // This is for the epsilon greedy strategy
        this.epsilon = Math.max(this.minEpsilon, this.epsilon * this.epsilonDecay);

        let state = this.createState(mapWalls, allBullets, myTeam, enemyTeam);
        let actionIndex = this.decideAction(state[0], state[1], this.epsilon); // Forward-propagation to get the NN decision
        let performData = this.performAction(actionIndex, delta);
        if (canShoot && performData[2]) {
            this.rotateTurret(performData[0], performData[1]);
            let returnedBullet = this.fireBullet();
            if (returnedBullet) {
                res.push(returnedBullet);
            }
        }

        let wallCollisionPenalty = -10;  // Adjust this value based on your reward structure
        let hitWall = false;  // Variable to track collision

        // Check for collision with walls
        for (let i = 0; i < mapWalls.length; i++) {
            for (let j = 0; j < mapWalls[i].length; j++) {
                if (this.isWallOrHole(mapWalls[i][j])) {
                    let wallX = mapWalls[i][j].body.x;
                    let wallY = mapWalls[i][j].body.y;
                    let wallWidth = mapWalls[i][j].body.width;
                    let wallHeight = mapWalls[i][j].body.height;

                    if (this.body.x < wallX + wallWidth &&
                        this.body.x + this.body.width > wallX &&
                        this.body.y < wallY + wallHeight &&
                        this.body.y + this.body.height > wallY) {
                        // Collision detected, revert to the previous position
                        this.body.x = prevX;
                        this.body.y = prevY;
                        hitWall = true;  // Mark the collision
                        break;
                    }
                }
            }
        }

        // Calculate velocity based on the new position
        this.velocityX = this.body.x - prevX;
        this.velocityY = this.body.y - prevY;

        if (this.velocityX !== 0 || this.velocityY !== 0) {
            this.movementAngle = Math.atan2(this.velocityY, this.velocityX);
        }

        // Assuming reward calculation and next state determination is done here
        let reward = this.calculateReward();  // Define this method based on your game mechanics

        if (hitWall) {
            reward += wallCollisionPenalty;  // Deduct the penalty from the current reward
        }

        this.reward = reward;

        let nextState = this.createState(mapWalls, allBullets, myTeam, enemyTeam);  // Get the new state after the action

        return [res, { state, action: actionIndex, reward, nextState }];
    }
}