import { isAfter, formatISO } from 'date-fns'
import gql from 'tagged-template-noop'
import { escapeRegExp } from 'lodash'
import { queryGraphQL } from './api'
import { ISearch, ICommitSearchResult } from './graphql-schema'

export async function determineCommitsToQuery(dates: Date[], repo: string): Promise<{ date: Date; commit: string }[]> {
    const commitQueries = dates.map(date => {
        const before = formatISO(date)
        return `repo:^${escapeRegExp(repo)}$ type:commit before:${before} count:1`
    })
    console.log('searching commits', commitQueries)
    const commitResults = await queryGraphQL<Record<string, ISearch>>(
        gql`
            query BulkSearchCommits(${commitQueries.map((query, index) => `$query${index}: String!`).join(', ')}) {
                ${commitQueries
                    .map(
                        (query, index) => gql`
                            search${index}: search(version: V2, patternType: literal, query: $query${index}) {
                                results {
                                    results {
                                        ... on CommitSearchResult {
                                            commit {
                                                oid
                                                committer {
                                                    date
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        `
                    )
                    .join('\n')}
            }
        `,
        Object.fromEntries(commitQueries.map((query, index) => [`query${index}`, query]))
    )
    const commitOids = Object.entries(commitResults).map(([name, search], index) => {
        const index_ = +name.slice('search'.length)
        if (index_ !== index) {
            throw new Error(`Expected field ${name} to be at index ${index_} of object keys`)
        }

        if (search.results.results.length === 0) {
            throw new Error(`No result for ${commitQueries[index_]}`)
        }
        const commit = (search.results.results[0] as ICommitSearchResult).commit

        // Sanity check
        const commitDate = commit.committer && new Date(commit.committer.date)
        const date = dates[index_]
        if (!commitDate) {
            throw new Error(`Expected commit to have committer: \`${commit.oid}\``)
        }
        if (isAfter(commitDate, date)) {
            throw new Error(
                `Expected commit \`${commit.oid}\` to be before ${formatISO(date)}, but was after: ${formatISO(
                    commitDate
                )}.\nSearch query: ${commitQueries[index_]}`
            )
        }

        return { commit: commit.oid, date }
    })

    return commitOids
}
