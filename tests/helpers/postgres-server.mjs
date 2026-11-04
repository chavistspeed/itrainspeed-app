// Keep the embedded runtime's process-exit hooks outside Node's test worker.
import EmbeddedPostgres from 'embedded-postgres'
const [root,port,password]=process.argv.slice(2)
const server=new EmbeddedPostgres({databaseDir:root,user:'postgres',password,port:Number(port),persistent:true,autoRehydrateSymlinks:true,postgresFlags:['-c','listen_addresses=127.0.0.1','-c','unix_socket_directories=/tmp'],onLog:m=>{if(process.env.PG_TEST_DEBUG)console.log(String(m))},onError:m=>console.error(String(m))})
let started=false
const stop=new Promise(resolve=>process.on('message',m=>{if(m==='stop')resolve()}))
try{
 await server.initialise();await server.start();started=true
 process.send?.({ready:true})
 await stop
}finally{
 if(started)await server.stop()
 if(process.connected)process.disconnect()
}
