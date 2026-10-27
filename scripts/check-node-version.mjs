const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22 || (major===22 && minor<13)){
 console.error(`DOS ESPACIOS necesita Node.js >=22.13. Detectado: ${process.version}. Instala la version LTS desde https://nodejs.org y vuelve a abrir la terminal.`);
 process.exit(1);
}
console.log(`Node.js ${process.version}: OK`);
