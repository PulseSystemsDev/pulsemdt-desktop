import Store from 'electron-store';
import type { PulseMDTConfig } from './types';

const store = new Store<PulseMDTConfig>({
  name: 'pulsemdt-config',
  defaults: {
    serverUrl: '',
    windowLayouts: {},
    openPanels: ['dispatch'],
  },
  schema: {
    serverUrl:     { type: 'string' },
    windowLayouts: { type: 'object' },
    openPanels:    { type: 'array' },
  },
});

export default store;
