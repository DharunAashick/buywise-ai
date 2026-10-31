import { bootstrapApplication } from '@angular/platform-browser';
import { AllCommunityModule as GridCommunityModule, ModuleRegistry as GridModuleRegistry } from 'ag-grid-community';
import { AllCommunityModule as ChartsCommunityModule, ModuleRegistry as ChartsModuleRegistry } from 'ag-charts-community';
import { appConfig } from './app/app.config';
import { App } from './app/app';

GridModuleRegistry.registerModules([GridCommunityModule]);
ChartsModuleRegistry.registerModules([ChartsCommunityModule]);

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
