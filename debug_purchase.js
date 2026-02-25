const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, 'datascrapper');
const id = 'art-studios-in-perry-georgia-united-states';
const parts = id.split('-in-');
const categorySlug = parts[0]; 
const locSlug = parts[1] || '';
const categoryFile = categorySlug.replace(/-/g, '_');

const findFiles = (dir, filelist = []) => {
    if (!fs.existsSync(dir)) return filelist;
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filepath = path.join(dir, file);
        if (fs.statSync(filepath).isDirectory()) {
            findFiles(filepath, filelist);
        } else {
            if (file === `${categoryFile}.json`) {
                filelist.push(filepath);
            }
        }
    });
    return filelist;
};

let allMatches = findFiles(baseDir);
let relevantFiles = allMatches;

if (locSlug) {
    const tokens = locSlug.split('-');
    relevantFiles = allMatches.filter(f => {
        const rel = path.relative(baseDir, f).replace(/\\/g, '/').toLowerCase(); 
        return tokens.every(t => rel.includes(t)); 
    });
}

console.log('Category file:', categoryFile);
console.log('locSlug:', locSlug);
console.log('All matches count:', allMatches.length);
console.log('Relevant files count:', relevantFiles.length);
console.log('Relevant files:', relevantFiles.map(f => path.relative(baseDir, f)));
