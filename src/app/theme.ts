import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

/** Aura con primario dorado sobrio y superficies grafito: estética de joyería, sin perder el tono empresarial. */
export const AurumPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#fbf8f0',
      100: '#f4ecd6',
      200: '#e8d7ab',
      300: '#d9bd7a',
      400: '#c9a352',
      500: '#b08a3a',
      600: '#946f2e',
      700: '#775727',
      800: '#5f4623',
      900: '#4e3a1f',
      950: '#2c200f',
    },
    colorScheme: {
      light: {
        surface: {
          0: '#ffffff',
          50: '#f8f8f7',
          100: '#f0efed',
          200: '#e2e0dc',
          300: '#cbc8c2',
          400: '#a29e96',
          500: '#7b776f',
          600: '#5f5b54',
          700: '#4a4741',
          800: '#33312d',
          900: '#24231f',
          950: '#161513',
        },
      },
    },
  },
});
