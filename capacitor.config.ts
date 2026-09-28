import type { CapacitorConfig } from '@capacitor/cli';

// appId follows reverse-domain convention, based on your iqrastudy.netlify.app
// domain — change it if you'd rather use a different package name, but note
// it becomes hard to change later (it's the Play Store listing's permanent ID).
const config: CapacitorConfig = {
  appId: 'com.iqrastudy.app',
  appName: 'IQRA',
  webDir: 'dist', // matches `vite build`'s default output folder
};

export default config;
