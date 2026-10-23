import type { Lang } from './lang.ts';

/**
 * What the shopper app stores and sends.
 *
 * Written from the code, not from a legal review. It is a description of
 * this build, not a compliance promise.
 */
export interface PrivacySection {
  id: string;
  heading: string;
  paragraphs: string[];
}

export interface PrivacyCopy {
  title: string;
  back: string;
  intro: string;
  sections: PrivacySection[];
  contactHeading: string;
  contactLead: string;
}

const ES: PrivacyCopy = {
  title: 'Privacidad',
  back: 'Volver',
  intro:
    'Esta página describe lo que hace el código de esta aplicación. No es un dictamen jurídico ni una promesa de cumplimiento.',
  sections: [
    {
      id: 'cuenta',
      heading: 'Cómo entrás',
      paragraphs: [
        'Podés usar Changuito como invitado. Para seguir después del límite, entrás con tu billetera. El ingreso lo confirma una prueba firmada: el servidor verifica esa prueba y recién ahí guarda una cookie de sesión (chg_user), HttpOnly, por 30 días. La dirección la saca de esa prueba, no de un dato que el navegador invente.',
        'La aplicación no pide ni recibe tu frase semilla.',
      ],
    },
    {
      id: 'chats',
      heading: 'Conversaciones y pedidos',
      paragraphs: [
        'En este navegador los chats quedan en localStorage, bajo claves que empiezan con changuito:. El turno en curso vive en el servidor cerca de una hora. Si entraste, el transcript se guarda además en la base, asociado a tu dirección. Suele incluir el código postal.',
        'Lo que escribís, y lo que responden las herramientas, se envía al modelo que el servidor tiene configurado. La búsqueda de productos va a los supermercados que el asistente consulta. Las fotos vienen de esas tiendas.',
      ],
    },
    {
      id: 'cookies',
      heading: 'Cookies y medición',
      paragraphs: [
        'chg_user es la sesión (HttpOnly). chg_human es la verificación de Cloudflare Turnstile y dura unas doce horas. chg_lang guarda el idioma y no es HttpOnly: el botón la escribe y solo elige palabras.',
        'Si el servidor tiene los identificadores, el navegador carga Google Analytics 4, Meta o Microsoft Clarity. Antes de enviar un evento, el cliente descarta la dirección, el texto largo, el email y otros campos que identificarían un pedido. Si esos identificadores no están, esos scripts no se cargan.',
      ],
    },
    {
      id: 'borrar',
      heading: 'Qué podés borrar acá',
      paragraphs: [
        'Borrar un chat en este navegador lo saca de este navegador. Cerrar sesión borra la cookie chg_user. El transcript guardado para una billetera que inició sesión no se va con eso.',
        'Lo que ya quedó escrito en la cadena no se puede borrar desde esta página.',
      ],
    },
  ],
  contactHeading: 'Contacto',
  contactLead:
    'Para un problema de la aplicación, el canal que ya existe es el reporte de errores. También están las cuentas públicas.',
};

const EN: PrivacyCopy = {
  title: 'Privacy',
  back: 'Back',
  intro:
    'This page describes what the code of this app does. It is not a legal opinion and it is not a compliance promise.',
  sections: [
    {
      id: 'cuenta',
      heading: 'How you sign in',
      paragraphs: [
        'You can use Changuito as a guest. To continue past the limit, you sign in with your wallet. Sign-in is a signed proof: the server checks that proof and only then stores a session cookie (chg_user), HttpOnly, for 30 days. It reads the address from that proof, not from an address the browser claims.',
        'The app does not ask for or receive your seed phrase.',
      ],
    },
    {
      id: 'chats',
      heading: 'Conversations and orders',
      paragraphs: [
        'This browser keeps chats in localStorage, under keys that start with changuito:. The turn in progress lives on the server for about an hour. Once you are signed in, the transcript is also stored in the database under your address. It usually includes the postal code.',
        'What you write, and what the tools answer, is sent to the model the server is configured with. Product search goes to the supermarkets the assistant queries. Photos come from those stores.',
      ],
    },
    {
      id: 'cookies',
      heading: 'Cookies and measurement',
      paragraphs: [
        'chg_user is the session (HttpOnly). chg_human is the Cloudflare Turnstile check and lasts about twelve hours. chg_lang stores the language and is not HttpOnly: the button writes it, and it only chooses words.',
        'When the server has the ids, the browser loads Google Analytics 4, Meta or Microsoft Clarity. Before an event is sent, the client drops the address, long text, email and other fields that would identify an order. If those ids are unset, those scripts are not loaded.',
      ],
    },
    {
      id: 'borrar',
      heading: 'What you can delete here',
      paragraphs: [
        'Deleting a chat in this browser removes it from this browser. Signing out clears the chg_user cookie. The transcript stored for a wallet that signed in does not leave with it.',
        'What is already written on the chain cannot be erased from this page.',
      ],
    },
  ],
  contactHeading: 'Contact',
  contactLead:
    'For a problem with the app, the channel that already exists is the bug report. The public accounts are there too.',
};

export function privacyCopy(lang: Lang): PrivacyCopy {
  return lang === 'en' ? EN : ES;
}
