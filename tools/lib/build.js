const fs = require("fs");
const build = require("./buildFuncs");
const generateJSONSchema = require("./generateJSONSchema");
const getSport = require("./getSport");
const buildJS = require("./build-js");
const buildSW = require("./build-sw");

module.exports = async () => {
	const sport = getSport();

	console.log(`Building ${sport}...`);

	build.reset();
	build.copyFiles();
	build.buildCSS();

	const jsonSchema = generateJSONSchema(sport);
	fs.mkdirSync("build/files", { recursive: true });
	fs.writeFileSync(
		"build/files/league-schema.json",
		JSON.stringify(jsonSchema, null, 2),
	);

	console.log("Bundling JavaScript files...");
	await buildJS();

	console.log("Generating sw.js...");
	await buildSW();
};
