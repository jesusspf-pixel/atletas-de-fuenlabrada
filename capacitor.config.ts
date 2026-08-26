import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.sportmed.atletasdefuenlabrada",
  appName: "Atletas de Fuenlabrada",
  webDir: "dist",
  backgroundColor: "#0b1930",
  ios: {
    contentInset: "automatic",
    preferredContentMode: "mobile",
  },
  android: {
    backgroundColor: "#0b1930",
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: "#0b1930",
      showSpinner: false,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#0b1930",
    },
  },
};

export default config;
