// Compile the actual repository JSX with the installed Next/SWC compiler.
// Rendering tests exercise real form markup without a production backend.
import {readFileSync} from 'node:fs'
import {resolve,dirname,extname} from 'node:path'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc'),cache=new Map()
export function loadComponent(file){
 file=resolve(file);if(cache.has(file))return cache.get(file)
 const compiled=swc.transformSync(readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}})
 const module={exports:{}};cache.set(file,module.exports);const ownRequire=createRequire(file)
 const localRequire=name=>{
  if(name.startsWith('.')){let path=resolve(dirname(file),name);if(!extname(path))path+='.js';if(path.includes('/components/')&&extname(path)==='.js')return loadComponent(path)}
  return ownRequire(name)
 }
 new Function('require','module','exports',compiled.code)(localRequire,module,module.exports);cache.set(file,module.exports);return module.exports
}
