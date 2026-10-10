import { createApp } from 'vue';
import Loading from './loading/Loading.vue';

// play.js lance alors le téléchargement sans attendre de touche, comme après un choix dans l'ancien menu de vel.gg :
// il ne reste qu'un clic, celui qui capture la souris.
globalThis.__kisakLandingPick = true;

createApp(Loading, { base: new URL('./', import.meta.url).pathname }).mount(document.body.appendChild(document.createElement('div')));
