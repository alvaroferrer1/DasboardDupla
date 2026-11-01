// Trabajos de cada hora: los mismos en Cloudflare (alarma del Durable Object) y en el servidor de reserva (setInterval).
export function hourlyJobs(app,env){
 return [
  ['reminders',()=>app.processReminders()],
  ['guardian',()=>app.processGuardianReview()],
  ['resumen',()=>app.processDailyBrief()],
  ['repaso',()=>app.processWeeklyReview()],
  ['avisos-dupla',()=>app.processAgentAlerts()],
  // Automation rules and third-party webhooks stay paused until the owners explicitly enable them.
  ...(env.DUPLA_AUTOMATIONS_ENABLED==='true'?[['automations',()=>app.processAutomationRules()]]:[]),
  ['limpieza',()=>app.processCleanup?.()],
  ['backup',()=>app.processScheduledBackup()],
  ['drive',()=>app.processDriveBackup()],
  ['email',()=>app.flushExternalNotices()],
  ['push',()=>app.flushPushNotices()],
  ...(env.DUPLA_AUTOMATIONS_ENABLED==='true'?[['webhooks',()=>app.flushWebhookQueue()]]:[])
 ];
}
// A failure in one scheduled subsystem must not prevent the others from running.
export async function runHourlyJobs(app,env){
 for(const [name,job] of hourlyJobs(app,env)){try{await job();}catch(e){console.error('DUPLA scheduled '+name+':',String(e?.message||e).slice(0,160));try{app.alertFailure(name,e);}catch{}}}
}
