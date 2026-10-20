import { initializeLanguage } from './language.js';
import { createDemonstrations } from './demonstrations.js';
import { createTour } from './tour.js';
import { initializeInstallation } from './installation.js';

initializeInstallation();

let demos;
let tour;
const language = initializeLanguage(() => demos?.update());
demos = createDemonstrations(language.getCopy, () => tour?.update());
tour = createTour(language.getCopy, demos.getXP);
tour.update();
