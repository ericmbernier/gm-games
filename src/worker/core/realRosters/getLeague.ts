import loadDataBasketball, { Basketball } from "./loadData.basketball";
import formatScheduledEvents from "./formatScheduledEvents";
import orderBy from "lodash/orderBy";
import type {
	GetLeagueOptions,
	DraftPickWithoutKey,
	DraftLotteryResult,
} from "../../../common/types";
import { defaultGameAttributes, helpers, random } from "../../util";
import { isSport, PHASE, PLAYER } from "../../../common";
import { player, team } from "..";
import { legendsInfo } from "./getLeagueInfo";
import genPlayoffSeeds from "../season/genPlayoffSeeds";
import getDraftProspects from "./getDraftProspects";
import formatPlayerFactory from "./formatPlayerFactory";
import nerfDraftProspect from "./nerfDraftProspect";
import getOnlyRatings from "./getOnlyRatings";
import oldAbbrevTo2020BBGMAbbrev from "./oldAbbrevTo2020BBGMAbbrev";
import addRelatives from "./addRelatives";

export const LATEST_SEASON = 2021;
export const LATEST_SEASON_WITH_DRAFT_POSITIONS = 2020;
const FIRST_SEASON_WITH_ALEXNOOB_ROSTERS = 2020;
const FREE_AGENTS_SEASON = 2020;

const genPlayoffSeries = (
	basketball: Basketball,
	initialTeams: ReturnType<typeof formatScheduledEvents>["initialTeams"],
	season: number,
	phase: number,
) => {
	const saveAllResults = phase > PHASE.PLAYOFFS;

	// Look at first 2 rounds, to find any byes
	const firstRound = basketball.playoffSeries[season].filter(
		row => row.round === 0,
	);
	const secondRound = basketball.playoffSeries[season].filter(
		row => row.round === 1,
	);

	type MatchupTeam = {
		tid: number;
		cid: number;
		winp: number;
		seed: number;
		won: number;
	};

	const firstRoundMatchups: {
		home: MatchupTeam;
		away?: MatchupTeam;
	}[] = [];
	const firstRoundAbbrevs = new Set();

	const genTeam = (
		abbrev: string,
		series: typeof basketball.playoffSeries[number][number],
		i: number,
	) => {
		firstRoundAbbrevs.add(abbrev);
		const t = initialTeams.find(
			t => oldAbbrevTo2020BBGMAbbrev(t.srID) === abbrev,
		);
		if (!t) {
			throw new Error("Missing team");
		}
		const teamSeason = basketball.teamSeasons[season][abbrev];
		if (!teamSeason) {
			throw new Error("Missing teamSeason");
		}
		const winp = helpers.calcWinp(teamSeason);

		return {
			tid: t.tid,
			cid: t.cid,
			winp,
			seed: series.seeds[i],
			won: saveAllResults ? series.wons[i] : 0,
		};
	};

	const genHomeAway = (series: typeof firstRound[number]) => {
		const teams = series.abbrevs.map((abbrev, i) => genTeam(abbrev, series, i));

		let home;
		let away;
		if (
			(teams[0].seed === teams[1].seed && teams[0].winp > teams[1].winp) ||
			teams[0].seed < teams[1].seed
		) {
			home = teams[0];
			away = teams[1];
		} else {
			home = teams[1];
			away = teams[0];
		}

		return { home, away };
	};

	for (const series of firstRound) {
		firstRoundMatchups.push(genHomeAway(series));
	}

	let numPlayoffTeams = 2 * firstRoundMatchups.length;
	let numPlayoffByes = 0;

	for (const series of secondRound) {
		for (let i = 0; i < series.abbrevs.length; i++) {
			const abbrev = series.abbrevs[i];
			if (!firstRoundAbbrevs.has(abbrev)) {
				// Appears in second round but not first... must have been a bye
				const home = genTeam(abbrev, series, i);
				firstRoundMatchups.push({
					home,
				});
				numPlayoffTeams += 1;
				numPlayoffByes += 1;
			}
		}
	}
	const numRounds = Math.log2(firstRoundMatchups.length);
	const series: typeof firstRoundMatchups[] = [];
	for (let i = 0; i <= numRounds; i++) {
		series.push([]);
	}

	// Reorder to match expected BBGM format
	if (season === 1947 || season === 1948 || season === 1950) {
		// These ones are hardcoded because their byes are weird, not like normal BBGM byes, so their seeds don't match up.

		let matchupsAbbrevs;
		// One team from each matchup
		if (season === 1947) {
			matchupsAbbrevs = ["CHI", "WSC", "NYC", "PHV"];
		} else if (season === 1948) {
			matchupsAbbrevs = ["STB", "PHV", "BLB", "CHI"];
		} else {
			matchupsAbbrevs = [
				"MNL",
				"FTW",
				"IND",
				"AND",
				"SYR",
				"PHV",
				"WSC",
				"NYC",
			];
		}

		const matchups = matchupsAbbrevs.map(abbrev => {
			const t = initialTeams.find(t => t.abbrev === abbrev);
			if (t) {
				const matchup = firstRoundMatchups.find(
					matchup =>
						t.tid === matchup.home.tid ||
						(matchup.away && t.tid === matchup.away.tid),
				);
				if (matchup) {
					return matchup;
				}
				throw new Error("Matchup not found");
			}
			throw new Error("Team not found");
		});
		series[0] = matchups;
	} else {
		const confSeeds = genPlayoffSeeds(numPlayoffTeams / 2, numPlayoffByes / 2);
		const cids = [0, 1];
		for (const cid of cids) {
			const confMatchups = firstRoundMatchups.filter(
				matchup => matchup.home.cid === cid,
			);
			for (const seeds of confSeeds) {
				const matchup = confMatchups.find(
					matchup =>
						matchup.home.seed - 1 === seeds[0] ||
						matchup.home.seed - 1 === seeds[1],
				);
				if (matchup) {
					series[0].push(matchup);
				}
			}
		}
	}

	// If necessary, add matchups for rounds after the first round
	if (saveAllResults) {
		for (let i = 1; i <= numRounds; i++) {
			const currentRound = series[i];
			const matchups = basketball.playoffSeries[season]
				.filter(row => row.round === i)
				.map(genHomeAway);

			// Iterate over every other game, and find the matchup in the next round that contains one of the teams in that game. This ensures order of the bracket is maintained.
			const previousRound = series[i - 1];
			for (let i = 0; i < previousRound.length; i += 2) {
				const { away, home } = previousRound[i];
				const previousTids = [home.tid];
				if (away) {
					previousTids.push(away.tid);
				}
				const currentMatchup = matchups.find(
					matchup =>
						previousTids.includes(matchup.home.tid) ||
						previousTids.includes(matchup.away.tid),
				);
				if (!currentMatchup) {
					throw new Error("Matchup not found");
				}
				currentRound.push(currentMatchup);
			}
		}
	}

	return [
		{
			season,
			currentRound: saveAllResults ? numRounds - 1 : 0,
			series,
		},
	];
};

const getLeague = async (options: GetLeagueOptions) => {
	if (!isSport("basketball")) {
		throw new Error(`Not supported for ${process.env.SPORT}`);
	}

	const basketball = await loadDataBasketball();

	// NO PLAYERS CAN BE ADDED AFTER CALLING THIS, otherwise there will be pid collisions
	const addFreeAgents = (
		players: {
			pid: number;
			tid: number;
		}[],
		season: number,
	) => {
		// Free agents were generated in 2020, so offset
		const numExistingFreeAgents = players.filter(
			p => p.tid === PLAYER.FREE_AGENT,
		).length;
		if (numExistingFreeAgents < 50) {
			let pid = Math.max(...players.map(p => p.pid));

			const freeAgents2 = helpers.deepCopy(
				basketball.freeAgents.slice(0, 50 - numExistingFreeAgents),
			);
			for (const p of freeAgents2) {
				let offset = FREE_AGENTS_SEASON - season;

				// Make them a bit older so they suck
				offset += 5;

				p.born.year -= offset;
				p.draft.year -= offset;
				pid += 1;
				p.pid = pid;
			}
			players.push(...freeAgents2);
		}
	};

	const scheduledEventsAll = [
		...basketball.scheduledEventsGameAttributes,
		...basketball.scheduledEventsTeams,
	];

	if (options.type === "real") {
		const {
			scheduledEvents,
			initialGameAttributes,
			initialTeams,
		} = formatScheduledEvents(
			scheduledEventsAll,
			options.season,
			options.phase,
		);

		const formatPlayer = formatPlayerFactory(
			basketball,
			options,
			options.season,
			initialTeams,
			-1,
		);

		const players = basketball.ratings
			.filter(row => row.season === options.season)
			.map(ratings =>
				formatPlayer(ratings, {
					randomDebuts: options.randomDebuts,
				}),
			);

		// Heal injuries, if necessary
		let gamesToHeal = 0;
		if (options.phase >= PHASE.PLAYOFFS) {
			// Regular season
			gamesToHeal +=
				initialGameAttributes.numGames ?? defaultGameAttributes.numGames;
		}
		if (options.phase >= PHASE.DRAFT) {
			// Offseason
			gamesToHeal += defaultGameAttributes.numGames;
		}
		if (gamesToHeal > 0) {
			for (const p of players) {
				if (!p.injury) {
					continue;
				}
				if (p.injury.gamesRemaining <= gamesToHeal) {
					p.injury = {
						type: "Healthy",
						gamesRemaining: 0,
					};
				} else {
					p.injury.gamesRemaining -= gamesToHeal;
				}
			}
		}

		// Find draft prospects, which can't include any active players
		const lastPID = Math.max(...players.map(p => p.pid));
		const draftProspects = getDraftProspects(
			basketball,
			players,
			initialTeams,
			scheduledEvents,
			lastPID,
			0,
			options,
		);

		players.push(...draftProspects);

		if (options.randomDebuts) {
			const toRandomize = players.filter(p => p.tid !== PLAYER.FREE_AGENT);

			const draftYears = toRandomize.map(p => p.draft.year);
			random.shuffle(draftYears);

			const tids = toRandomize.filter(p => p.tid >= 0).map(p => p.tid);
			random.shuffle(tids);

			for (let i = 0; i < toRandomize.length; i++) {
				const p = toRandomize[i];
				const diff = draftYears[i] - p.draft.year;
				p.draft.year = draftYears[i];
				p.born.year += diff;

				if (p.draft.year < options.season) {
					// Active player on a team
					const tid = tids.pop();
					if (tid === undefined) {
						throw new Error("Not enough tids");
					}

					p.tid = tid;

					const targetRatingsSeason = options.season - diff;

					const rows = basketball.ratings.filter(row => row.slug === p.srID);
					if (rows.length === 0) {
						throw new Error(`No ratings found for "${p.srID}"`);
					}

					// If possible, use ratings from exact age
					let ratings = rows.find(row => row.season === targetRatingsSeason);

					// Otherwise, find closest
					if (!ratings) {
						const sorted = orderBy(
							rows,
							row => Math.abs(row.season - targetRatingsSeason),
							"asc",
						);
						ratings = sorted[0];
					}

					p.ratings = [getOnlyRatings(ratings)];
				} else {
					// Draft prospect
					p.tid = PLAYER.UNDRAFTED;

					const rookieRatings = basketball.ratings.find(
						row => row.slug === p.srID,
					);
					if (!rookieRatings) {
						throw new Error(`No ratings found for "${p.srID}"`);
					}
					const ratings = getOnlyRatings(rookieRatings);
					nerfDraftProspect(ratings);
					p.ratings = [ratings];
				}
			}
		}

		const gameAttributes: Record<string, unknown> = {
			maxRosterSize: 17,
			...initialGameAttributes,
		};

		if (
			options.season >= FIRST_SEASON_WITH_ALEXNOOB_ROSTERS &&
			!options.randomDebuts
		) {
			gameAttributes.numSeasonsFutureDraftPicks = 7;
		}

		if (options.phase !== PHASE.PRESEASON) {
			gameAttributes.phase = options.phase;
		}

		const getDraftPickTeams = (
			dp: Basketball["draftPicks"][number][number],
		) => {
			const t = initialTeams.find(
				t => oldAbbrevTo2020BBGMAbbrev(t.srID) === dp.abbrev,
			);
			if (!t) {
				throw new Error(`Team not found for draft pick abbrev ${dp.abbrev}`);
			}

			let t2;
			if (dp.originalAbbrev) {
				t2 = initialTeams.find(
					t => oldAbbrevTo2020BBGMAbbrev(t.srID) === dp.originalAbbrev,
				);
				if (!t2) {
					throw new Error(
						`Team not found for draft pick abbrev ${dp.originalAbbrev}`,
					);
				}
			} else {
				t2 = t;
			}

			return [t, t2];
		};

		let draftPicks: DraftPickWithoutKey[] | undefined;
		let draftLotteryResults: DraftLotteryResult[] | undefined;
		// Special case for 2020+ because we only have traded draft picks for the "current" season, we don't store history
		const includeDraftPicks2020AndFuture =
			options.season >= 2020 &&
			!options.randomDebuts &&
			!!basketball.draftPicks[options.season];
		const includeRealizedDraftPicksThisSeason = options.phase === PHASE.DRAFT;
		if (includeDraftPicks2020AndFuture || includeRealizedDraftPicksThisSeason) {
			draftPicks = basketball.draftPicks[options.season]
				.filter(dp => {
					if (dp.round > 2) {
						return false;
					}

					// For alexnoob traded draft picks, don't include current season if starting after draft
					if (
						options.phase > PHASE.DRAFT &&
						dp.season !== undefined &&
						dp.season === options.season
					) {
						return false;
					}

					return true;
				})
				.map(dp => {
					const [t, t2] = getDraftPickTeams(dp);

					return {
						tid: t.tid,
						originalTid: t2.tid,
						round: dp.round,
						pick:
							includeRealizedDraftPicksThisSeason && dp.pick !== undefined
								? dp.pick
								: 0,
						season: dp.season ?? options.season,
					};
				});
		}
		if (includeRealizedDraftPicksThisSeason) {
			draftLotteryResults = [
				{
					season: options.season,
					draftType: "dummy",
					result: [],
				},
			];
		}

		let playoffSeries;
		if (options.phase >= PHASE.PLAYOFFS) {
			playoffSeries = genPlayoffSeries(
				basketball,
				initialTeams,
				options.season,
				options.phase,
			);

			for (const t of initialTeams) {
				const teamSeasonData =
					basketball.teamSeasons[options.season][
						oldAbbrevTo2020BBGMAbbrev(t.srID)
					];
				if (!teamSeasonData) {
					// Must be an expansion team
					continue;
				}

				const teamSeason = team.genSeasonRow(
					t,
					undefined,
					initialTeams.length,
					options.season,
					defaultGameAttributes.defaultStadiumCapacity,
				);
				const keys = [
					"won",
					"lost",
					"wonHome",
					"lostHome",
					"wonAway",
					"lostAway",
					"wonDiv",
					"lostDiv",
					"wonConf",
					"lostConf",
				] as const;
				for (const key of keys) {
					teamSeason[key] = teamSeasonData[key];
				}

				for (let i = 0; i < playoffSeries[0].series.length; i++) {
					const round = playoffSeries[0].series[i];
					for (const matchup of round) {
						if (
							(matchup.away && matchup.away.tid === t.tid) ||
							matchup.home.tid === t.tid
						) {
							if (i === 0) {
								teamSeason.clinchedPlayoffs = "x";
							}
							if (i === 0 || options.phase > PHASE.PLAYOFFS) {
								// Only record the first round, if this is the playoffs phase
								teamSeason.playoffRoundsWon = i;
							}
						}
					}
				}

				// Find who actually won title
				if (options.phase > PHASE.PLAYOFFS) {
					const { home, away } = playoffSeries[0].series[
						playoffSeries[0].series.length - 1
					][0];
					if (away) {
						const champ = (home.won > away.won ? home : away).tid;
						if (teamSeason.tid === champ) {
							teamSeason.playoffRoundsWon += 1;
						}
					}
				}

				(t as any).seasons = [teamSeason];
			}
		}

		// Make players as retired - don't delete, so we have full season stats and awards.
		// This is done down here because it needs to be after the playoffSeries stuff adds the "Won Championship" award.
		// Skip 2021 because we don't have 2021 data yet!
		if (options.phase > PHASE.PLAYOFFS && options.season < 2021) {
			const nextSeasonSlugs = new Set();
			for (const row of basketball.ratings) {
				if (row.season === options.season + 1) {
					nextSeasonSlugs.add(row.slug);
				}
			}

			for (const p of players) {
				if (p.tid >= 0 && !nextSeasonSlugs.has(p.srID)) {
					p.tid = PLAYER.RETIRED;
					(p as any).retiredYear = options.season;
				}
			}
		}

		// Assign expansion draft players to their teams
		if (
			options.phase >= PHASE.DRAFT_LOTTERY &&
			basketball.expansionDrafts[options.season]
		) {
			for (const [abbrev, slugs] of Object.entries(
				basketball.expansionDrafts[options.season],
			)) {
				const t = initialTeams.find(t => abbrev === t.abbrev);
				console.log(abbrev, slugs);
				console.log(initialTeams, t);
				if (!t) {
					throw new Error("Team not found");
				}

				t.firstSeasonAfterExpansion = options.season + 1;

				for (const p of players) {
					if (slugs.includes(p.srID)) {
						p.tid = t.tid;
					}
				}
			}
		}

		// Assign drafted players to their teams
		if (options.phase > PHASE.DRAFT) {
			for (const dp of basketball.draftPicks[options.season]) {
				if (!dp.slug) {
					continue;
				}

				const p = players.find(p => p.srID === dp.slug);
				if (!p) {
					throw new Error("Player not found");
				}
				if (dp.pick === undefined) {
					throw new Error("No pick number");
				}

				const [t, t2] = getDraftPickTeams(dp);

				p.tid = t.tid;
				p.draft = {
					round: dp.round,
					pick: dp.pick,
					tid: t.tid,
					year: options.season,
					originalTid: t2.tid,
				};

				// Contract - this should work pretty well for players with contract data. Other players (like from the old days) will have this randomly generated in augmentPartialPlayer.
				const salaryRow = basketball.salaries.find(
					row => row.start <= options.season + 1 && row.slug === p.srID,
				);
				if (salaryRow) {
					p.contract = {
						amount: salaryRow.amount / 1000,
						exp: salaryRow.exp,
					};

					let minYears =
						defaultGameAttributes.rookieContractLengths[dp.round - 1] ??
						defaultGameAttributes.rookieContractLengths[
							defaultGameAttributes.rookieContractLengths.length - 1
						];

					// Offset because it starts next season
					minYears += 1;

					if (p.contract.exp < options.season + minYears) {
						p.contract.exp = options.season + minYears;
					}

					if (p.contract.exp > options.season + 5) {
						// Bound at 5 year contract
						p.contract.exp = options.season + 5;
					}
				}
			}
		}

		addRelatives(players, basketball.relatives);
		addFreeAgents(players, options.season);

		return {
			version: 37,
			startingSeason: options.season,
			players,
			teams: initialTeams,
			scheduledEvents,
			gameAttributes,
			draftPicks,
			draftLotteryResults,
			playoffSeries,
		};
	} else if (options.type === "legends") {
		const NUM_PLAYERS_PER_TEAM = 15;

		const season = legendsInfo[options.decade].end;
		const { initialGameAttributes, initialTeams } = formatScheduledEvents(
			scheduledEventsAll,
			season,
		);

		const hasQueens = initialTeams.some(t => t.name === "Queens");

		const formatPlayer = formatPlayerFactory(
			basketball,
			options,
			season,
			initialTeams,
			-1,
		);

		let players = orderBy(
			basketball.ratings,
			ratings => player.ovr(ratings as any),
			"desc",
		)
			.filter(
				ratings =>
					ratings.season >= legendsInfo[options.decade].start &&
					ratings.season <= legendsInfo[options.decade].end,
			)
			.map(ratings =>
				formatPlayer(ratings, {
					legends: true,
					hasQueens,
				}),
			)
			.filter(p => p.tid >= 0);

		const keptPlayers = [];
		const numPlayersPerTeam = Array(initialTeams.length).fill(0);
		while (
			players.length > 0 &&
			keptPlayers.length < NUM_PLAYERS_PER_TEAM * initialTeams.length
		) {
			const p = players.shift();
			if (p && numPlayersPerTeam[p.tid] < NUM_PLAYERS_PER_TEAM) {
				keptPlayers.push(p);
				numPlayersPerTeam[p.tid] += 1;

				// Remove other years of this player
				players = players.filter(p2 => p2.srID !== p.srID);
			}
		}

		const gameAttributes: Record<string, unknown> = {
			maxRosterSize: 17,
			aiTradesFactor: 0,
		};

		const ignoreGameAttributes = [
			"salaryCap",
			"luxuryPayroll",
			"minPayroll",
			"minContract",
			"maxContract",
		];
		for (const [key, value] of Object.entries(initialGameAttributes)) {
			if (!ignoreGameAttributes.includes(key)) {
				gameAttributes[key] = value;
			}
		}

		addRelatives(keptPlayers, basketball.relatives);
		addFreeAgents(keptPlayers, season);

		return {
			version: 37,
			startingSeason: season,
			players: keptPlayers,
			teams: initialTeams,
			gameAttributes,
		};
	}

	// @ts-ignore
	throw new Error(`Unknown type "${options.type}"`);
};

export default getLeague;
