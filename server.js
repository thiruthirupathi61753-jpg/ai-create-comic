require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
app.use(express.json({limit:"1mb"}));
app.use(express.static(__dirname));

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return {users:[], comics:[]}; }
}
function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
const sessions = new Map();
function userFor(req) {
  const token = (req.headers.cookie || "").split(";").map(x=>x.trim()).find(x=>x.startsWith("cc_session="));
  return token ? sessions.get(decodeURIComponent(token.slice("cc_session=".length))) : null;
}
function requireUser(req,res,next) {
  const user = userFor(req);
  if (!user) return res.status(401).json({success:false,message:"Please login first."});
  req.user = user; next();
}
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}
app.post("/api/register", (req,res)=>{
  const username=String(req.body.username||"").trim();
  const password=String(req.body.password||"");
  if(username.length<3 || password.length<4) return res.status(400).json({success:false,message:"Username needs 3+ characters and password 4+ characters."});
  const data=loadData();
  if(data.users.some(u=>u.username.toLowerCase()===username.toLowerCase())) return res.status(409).json({success:false,message:"Username already exists."});
  const salt=crypto.randomBytes(16).toString("hex");
  const user={id:crypto.randomUUID(),username,salt,passwordHash:hashPassword(password,salt)};
  data.users.push(user); saveData(data);
  const token=crypto.randomBytes(32).toString("hex"); sessions.set(token,{id:user.id,username:user.username});
  res.setHeader("Set-Cookie",`cc_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`);
  res.json({success:true,username});
});
app.post("/api/login",(req,res)=>{
  const username=String(req.body.username||"").trim(), password=String(req.body.password||"");
  const data=loadData(), user=data.users.find(u=>u.username.toLowerCase()===username.toLowerCase());
  if(!user || hashPassword(password,user.salt)!==user.passwordHash) return res.status(401).json({success:false,message:"Invalid username or password."});
  const token=crypto.randomBytes(32).toString("hex"); sessions.set(token,{id:user.id,username:user.username});
  res.setHeader("Set-Cookie",`cc_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`);
  res.json({success:true,username:user.username});
});
app.post("/api/logout",(req,res)=>{
  const raw=(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("cc_session="));
  if(raw) sessions.delete(decodeURIComponent(raw.slice("cc_session=".length)));
  res.setHeader("Set-Cookie","cc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({success:true});
});
app.get("/api/me",(req,res)=>{const u=userFor(req);res.json({success:true,user:u||null});});

function demoStory(idea,genre,count) {
 const title=idea ? idea.trim().replace(/[.!?]+$/,"") : "The Secret of Star Island";
 const names=["Mira","Kavi","Bolt"];
 const scenes=[
  `A mysterious clue appears near ${title}.`,
  `${names[0]} discovers a surprising secret.`,
  `${names[1]} joins the adventure with a clever plan.`,
  `${names[2]} helps the friends overcome a challenge.`,
  `The friends work together and find the answer.`,
  `A joyful ending begins a new adventure.`
 ];
 return {title:title.length>48?title.slice(0,45)+"...":title,summary:`A ${genre||"adventure"} comic about courage, friendship, and discovery.`,characters:names.slice(0,Math.min(3,count)).map((n,i)=>`${n} — ${["curious explorer","clever friend","helpful robot"][i]}`),panels:Array.from({length:count},(_,i)=>({number:i+1,scene:scenes[i%scenes.length],dialogue:[`“Let’s find out!”`,`“I have an idea!”`,`“We can do this together!”`][i%3]}))};
}
app.post("/api/generate",async(req,res)=>{
 const idea=String(req.body.idea||"").trim(), genre=String(req.body.genre||"Adventure");
 const count=Math.min(8,Math.max(3,Number(req.body.count)||4));
 if(!idea) return res.status(400).json({success:false,message:"Please enter a story idea."});
 if(process.env.GEMINI_API_KEY) {
  try {
   const {GoogleGenAI}=require("@google/genai");
   const ai=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});
   const prompt=`Create a kid-friendly ${genre} comic based on: ${idea}. Return ONLY valid JSON with keys title, summary, characters (array of strings), panels (array of exactly ${count} objects with number, scene, dialogue).`;
   const result=await ai.models.generateContent({model:"gemini-3.8-flash",contents:prompt});
   let raw=result.text||"";
   raw=raw.replace(/```json/gi,"").replace(/```/g,"").trim();
   const parsed=JSON.parse(raw);
   if(!Array.isArray(parsed.panels)||!parsed.title) throw new Error("Unexpected response format");
   parsed.panels=parsed.panels.slice(0,count).map((p,i)=>({number:i+1,scene:String(p.scene||""),dialogue:String(p.dialogue||"")}));
   return res.json({success:true,story:parsed,mode:"gemini"});
  } catch(err) { console.error("Gemini generation failed:",err.message); }
 }
 res.json({success:true,story:demoStory(idea,genre,count),mode:"demo",notice:"Demo story generated. Add a valid Gemini API key to enable AI generation."});
});
app.get("/api/comics",requireUser,(req,res)=>{
 const data=loadData(); res.json({success:true,comics:data.comics.filter(c=>c.userId===req.user.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))});
});
app.post("/api/comics",requireUser,(req,res)=>{
 const {title,summary,characters,panels}=req.body;
 if(!Array.isArray(panels)) return res.status(400).json({success:false,message:"Comic panels are missing."});
 const data=loadData(), comic={id:crypto.randomUUID(),userId:req.user.id,title:String(title||"Untitled Comic"),summary:String(summary||""),characters:Array.isArray(characters)?characters:[],panels,createdAt:new Date().toISOString()};
 data.comics.push(comic);saveData(data);res.json({success:true,comic});
});
app.delete("/api/comics/:id",requireUser,(req,res)=>{
 const data=loadData(), before=data.comics.length;
 data.comics=data.comics.filter(c=>!(c.id===req.params.id&&c.userId===req.user.id));
 if(data.comics.length===before)return res.status(404).json({success:false,message:"Comic not found."});
 saveData(data);res.json({success:true});
});
app.listen(PORT,()=>console.log(`ComicCraft ready at http://localhost:${PORT}`));