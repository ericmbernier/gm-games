import { gameAttributesArrayToObject } from "../../../common";
import { getAll, idb } from "../../db";
import { g, local } from "../../util";
import getName from "./getName";

/* Export existing active league.
 *
 * @memberOf core.league
 * @param {string[]} stores Array of names of objectStores to include in export
 * @return {Promise} Resolve to all the exported league data.
 */
const exportLeague = async (
	stores: string[],
	options: {
		meta: boolean;
		filter: {
			[key: string]: (a: any) => boolean;
		};
	} = {
		meta: true,
		filter: {},
	},
) => {
	// Always flush before export, so export is current!
	await idb.cache.flush();
	const exportedLeague: any = {
		version: idb.league.version,
	};

	// Row from leagueStore in meta db.
	// phaseText is needed if a phase is set in gameAttributes.
	// name is only used for the file name of the exported roster file.
	if (options.meta) {
		const leagueName = await getName();
		exportedLeague.meta = {
			phaseText: local.phaseText,
			name: leagueName,
		};
	}

	await Promise.all(
		stores.map(async store => {
			exportedLeague[store] = await getAll(
				idb.league.transaction(store as any).store,
				undefined,
				options.filter[store],
			);
		}),
	);

	if (stores.includes("players")) {
		// Don't export cartoon face if imgURL is provided
		exportedLeague.players = exportedLeague.players.map((p: any) => {
			if (p.imgURL && p.imgURL !== "") {
				const p2 = { ...p };
				delete p2.face;
				return p2;
			}

			return p;
		});
	}

	if (stores.includes("teams")) {
		for (let i = 0; i < exportedLeague.teamSeasons.length; i++) {
			const tid = exportedLeague.teamSeasons[i].tid;

			for (let j = 0; j < exportedLeague.teams.length; j++) {
				if (exportedLeague.teams[j].tid === tid) {
					if (!exportedLeague.teams[j].hasOwnProperty("seasons")) {
						exportedLeague.teams[j].seasons = [];
					}

					exportedLeague.teams[j].seasons.push(exportedLeague.teamSeasons[i]);
					break;
				}
			}
		}

		for (let i = 0; i < exportedLeague.teamStats.length; i++) {
			const tid = exportedLeague.teamStats[i].tid;

			for (let j = 0; j < exportedLeague.teams.length; j++) {
				if (exportedLeague.teams[j].tid === tid) {
					if (!exportedLeague.teams[j].hasOwnProperty("stats")) {
						exportedLeague.teams[j].stats = [];
					}

					exportedLeague.teams[j].stats.push(exportedLeague.teamStats[i]);
					break;
				}
			}
		}

		delete exportedLeague.teamSeasons;
		delete exportedLeague.teamStats;
	}

	if (stores.includes("gameAttributes")) {
		// Remove cached variables, since they will be auto-generated on re-import but are confusing if someone edits the JSON
		const keysToDelete = ["numActiveTeams", "teamInfoCache"];
		const gaArray = exportedLeague.gameAttributes
			.filter((gameAttribute: any) => !keysToDelete.includes(gameAttribute.key))
			.filter(
				// No point in exporting undefined
				(gameAttribute: any) => gameAttribute.value !== undefined,
			);

		exportedLeague.gameAttributes = gameAttributesArrayToObject(gaArray);
	} else {
		// Set startingSeason if gameAttributes is not selected, otherwise it's going to fail loading unless startingSeason is coincidentally the same as the default
		exportedLeague.startingSeason = g.get("startingSeason");
	}

	// No need emitting empty object stores
	for (const key of Object.keys(exportedLeague)) {
		if (
			Array.isArray(exportedLeague[key]) &&
			exportedLeague[key].length === 0
		) {
			delete exportedLeague[key];
		}
	}

	return exportedLeague;
};

export default exportLeague;
