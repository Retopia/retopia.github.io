import { Bullet } from "../BulletTypes/Bullet.js";
export class RLTank {

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

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));  // Random index from 0 to i
            [array[i], array[j]] = [array[j], array[i]];  // Swap elements
        }
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

    reshapeAndWrapGrid(flatGrid) {
        try {
            const reshapedGrid = this.reshapeArray(flatGrid, 30, 40);
            return reshapedGrid.map(row => row.map(cell => [cell]));
        } catch (error) {
            console.error("Error reshaping grid data:", error);
            return [];
        }
    }


    reshapeArray(flatArray, numRows, numCols) {
        if (flatArray.length !== numRows * numCols) {
            throw new Error("Array length does not match expected dimensions.");
        }
        let reshaped = [];
        for (let i = 0; i < numRows; i++) {
            let start = i * numCols;
            let end = start + numCols;
            reshaped.push(flatArray.slice(start, end));
        }
        return reshaped;
    }

    createModel() {
        // CNN for Grid Data
        // size 1200
        const gridInput = tf.input({ shape: [30, 40, 1] }); // Adjust the shape based on your grid representation
        let cnn = tf.layers.conv2d({ filters: 32, kernelSize: [3, 3], activation: 'relu' }).apply(gridInput);
        cnn = tf.layers.maxPooling2d({ poolSize: [2, 2] }).apply(cnn);
        cnn = tf.layers.conv2d({ filters: 64, kernelSize: [3, 3], activation: 'relu' }).apply(cnn);
        cnn = tf.layers.maxPooling2d({ poolSize: [2, 2] }).apply(cnn);
        cnn = tf.layers.flatten().apply(cnn);

        // Input for Tank and Bullet Data
        // (x, y) coords for each
        // Max of 8 tanks at once
        // Max of 5 bullets per tank
        // 8 * 2 + 5 * 2 = size 26
        const tankBulletInput = tf.input({ shape: [26] });

        // Combine CNN and Tank/Bullet Data
        const combinedInput = tf.layers.concatenate().apply([cnn, tankBulletInput]);

        // Dense Layers after combining
        let network = tf.layers.dense({ units: 128, activation: 'relu' }).apply(combinedInput);
        network = tf.layers.dense({ units: 64, activation: 'relu' }).apply(network);
        const output = tf.layers.dense({ units: 16, activation: 'linear' }).apply(network); // 16 units for 16 actions

        // Create and Compile Model
        const model = tf.model({ inputs: [gridInput, tankBulletInput], outputs: output });
        model.compile({ optimizer: tf.train.adam(), loss: 'meanSquaredError' });

        this.model = model;

        return model;
    }

    decideAction(mapData, tankBulletData, epsilon) {
        // Decide on random action based on epsilon
        if (Math.random() < epsilon) {
            return Math.floor(Math.random() * 16);
        }

        // Prepare tensors for prediction
        const gridTensor = tf.tensor([mapData], [1, 30, 40, 1]); // Shape as [batch, height, width, channels]
        const tankBulletTensor = tf.tensor([tankBulletData], [1, 26]); // Shape as [batch, features]

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

    createState(mapWalls, allBullets, myTeam, enemyTeam) {
        let flatGrid = mapWalls.flat();
        let mapData = [];

        for (let i = 0; i < flatGrid.length; i++) {
            if (flatGrid[i].getCellType() === 'wall') {
                mapData.push(1);
            } else {
                mapData.push(0);
            }
        }

        let flatBullets = allBullets.flat();
        let bulletData = [];
        for (let i = 0; i < flatBullets.length; i++) {
            let currBody = flatBullets[i].body;
            bulletData.push(currBody.x + currBody.width / 2);
            bulletData.push(currBody.y + currBody.height / 2);
        }

        let flatEnemyTeam = enemyTeam.flat();
        let tankData = [];
        for (let i = 0; i < flatEnemyTeam.length; i++) {
            let currBody = flatEnemyTeam[i].body;
            tankData.push(currBody.x + currBody.width / 2);
            tankData.push(currBody.y + currBody.height / 2);
        }

        let flatMyTeam = myTeam.flat();
        for (let i = 0; i < flatMyTeam.length; i++) {
            let currBody = flatMyTeam[i].body;
            // RLTank's data should always be in the front
            // Hopefully the NN "learns" this
            if (flatMyTeam[i] == this) {
                tankData.unshift(currBody.x + currBody.width / 2);
                tankData.unshift(currBody.y + currBody.height / 2);
            } else {
                tankData.push(currBody.x + currBody.width / 2);
                tankData.push(currBody.y + currBody.height / 2);
            }
        }


        // Normalize bullet and tank data
        bulletData = this.normalize(bulletData);
        tankData = this.normalize(tankData);

        // Ensure the size is fixed to 26 for tankBulletInput
        while (tankData.length + bulletData.length < 26) {
            tankData.push(-1);  // Padding unused spaces
        }

        return [mapData, bulletData.concat(tankData)]; // Return as separate arrays
    }

    async trainModel(batchSize) {
        const weightsBefore = this.getWeightsSnapshot(this.model);

        this.isTraining = true;
        if (this.replayBuffer.length < batchSize) return;  // Ensure there are enough samples

        // Create an array of indices and shuffle it
        const indices = Array.from(Array(this.replayBuffer.length).keys());
        this.shuffleArray(indices);  // Shuffle the array using the implemented function

        // Slice the first 'batchSize' indices
        const batchIndices = indices.slice(0, batchSize);

        // Use these indices to select experiences from the replay buffer
        const batch = batchIndices.map(index => this.replayBuffer[index]);

        const gridData = batch.map(exp => {
            try {
                // Reshape each flattened grid data into 2D
                const reshapedGrid = this.reshapeArray(exp.state[0], 30, 40);
                // Convert each cell to [cell] for the channel dimension
                return reshapedGrid.map(row => row.map(cell => [cell]));
            } catch (error) {
                console.error("Error reshaping grid data:", error);
                return [];  // Return an empty array or handle as needed
            }
        });

        let gridTensor = tf.tensor4d(gridData);

        // Extract and prepare tank/bullet data
        const tankBulletData = batch.map(exp => exp.state[1]);  // exp.state[1] should be the tank/bullet data
        const tankBulletTensor = tf.tensor2d(tankBulletData, [batchSize, 26]);  // Shape as [batch, features]

        // Extract actions and rewards, calculate target Q-values
        const actions = batch.map(exp => exp.action);
        const rewards = batch.map(exp => exp.reward);
        const rewardTensor = tf.tensor1d(rewards);
        const nextStates = batch.map(exp => exp.nextState);

        // Applying similar reshaping for next grid data
        const nextGridData = nextStates.map(state => {
            try {
                const reshapedNextGrid = this.reshapeArray(state[0], 30, 40);
                return reshapedNextGrid.map(row => row.map(cell => [cell]));
            } catch (error) {
                console.error("Error reshaping next grid data:", error);
                return [];  // Return an empty array or handle as needed
            }
        });

        const nextGridTensor = tf.tensor4d(nextGridData);

        const nextTankBulletData = nextStates.map(state => state[1]);
        const nextTankBulletTensor = tf.tensor2d(nextTankBulletData, [batchSize, 26]);

        // Predict current and next Q values
        const currentQs = this.model.predict([gridTensor, tankBulletTensor]);
        // Predict next Q values and find the max for each batch entry
        const nextQs = this.model.predict([nextGridTensor, nextTankBulletTensor]);
        const maxNextQsTensor = nextQs.max(1); // Assuming it reduces along the appropriate axis

        // Convert tensor to array synchronously (ensure this is suitable for your app's performance needs)
        const maxNextQs = maxNextQsTensor.dataSync();

        // Compute the target Q-values
        const targets = currentQs.arraySync();  // Get current predictions as an array
        actions.forEach((action, index) => {
            targets[index][action] = rewards[index] + this.gamma * maxNextQs[index];  // Use array access
        });

        // Prepare the tensor from the updated targets array
        const targetsTensor = tf.tensor2d(targets, [batchSize, 16]);

        // Train the model
        await this.model.fit([gridTensor, tankBulletTensor], targetsTensor, {
            epochs: 1,
            batchSize
        });

        console.log("done training!")
        this.isTraining = false;

        // After training
        const weightsAfter = this.getWeightsSnapshot(this.model);
        console.log("Are weights different?", this.areWeightsDifferent(weightsBefore, weightsAfter));
    }

    async calculateReward() {
        let reward = 1; // Start at 1 cause it's alive

        // Check if the agent hit an enemy tank
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
        // For example, moving closer to an enemy or avoiding a bullet could be slightly rewarde
        return reward;
    }

    getWeightsSnapshot(model) {
        return model.layers.map(layer => layer.getWeights().map(weightTensor => weightTensor.dataSync()));
    }

    areWeightsDifferent(weightsBefore, weightsAfter) {
        return weightsBefore.some((layerWeights, i) =>
            layerWeights.some((tensorWeights, j) =>
                !tensorWeights.every((weight, k) => weight === weightsAfter[i][j][k])
            )
        );
    }

    update(delta, mapWalls, player, collisionLines, allBullets, myTeam, enemyTeam, replayBuffer, stepCount) {
        this.replayBuffer = replayBuffer;

        let res = [];
        let canShoot = false;

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
                        break;
                    }
                }
            }
        }

        // Assuming reward calculation and next state determination is done here
        let reward = this.calculateReward();  // Define this method based on your game mechanics
        let nextState = this.createState(mapWalls, allBullets, myTeam, enemyTeam);  // Get the new state after the action

        // console.log(this.replayBuffer.length)
        // Train every 1000 steps and when we have enough data
        if (this.replayBuffer.length >= 1000 && !this.isTraining && stepCount % 1000 === 0) {
            // console.log("Buffer Size:", this.replayBuffer.length * (this.replayBuffer[0].state.flat().length + 1 + 1 + this.replayBuffer[0].nextState.flat().length))
            this.trainModel(32);  // Batch size of 32
        }

        return [res, { state, action: actionIndex, reward, nextState }];
    }
}