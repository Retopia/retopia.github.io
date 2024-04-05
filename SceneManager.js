import { Game } from './Game.js';
import { MapBuilder } from './MapBuilder.js';

let currentScene = 'game'; // Also used to set the initial scene (map/game)
let mapBuilder = null;
let game = null;
const switchSceneButton = document.getElementById('switchSceneButton');

switchSceneButton.addEventListener('click', (event) => {
    if (currentScene === 'game') {
        game.cleanup();
        mapBuilder = new MapBuilder();
        mapBuilder.setup();
        currentScene = 'map';
        switchSceneButton.textContent = 'Switch to Game';
    } else {
        mapBuilder.cleanup()
        game = new Game();
        game.setup();
        currentScene = 'game';
        switchSceneButton.textContent = 'Switch to Map Builder';
    }
});

if (currentScene === 'map') {
    mapBuilder = new MapBuilder();
    mapBuilder.setup();
    switchSceneButton.textContent = 'Switch to Game';
} else {
    game = new Game();
    game.setup();
    switchSceneButton.textContent = 'Switch to Map Builder';
}