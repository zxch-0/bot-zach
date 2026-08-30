// Déclarations de types pour la vérification statique (tsc --checkJs).
// "export {}" fait de ce fichier un module : les "declare module" ci-dessous
// AUGMENTENT les types de discord.js au lieu de les remplacer.
export {};

declare module 'discord.js' {
  interface Client {
    commands: import('discord.js').Collection<any, any>;
    store: any; // instance de src/storage (JsonStore ou PostgresStore)
  }
}
