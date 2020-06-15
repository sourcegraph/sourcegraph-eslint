import { IQuery, IGraphQLResponseRoot } from './graphql-schema'
import * as sourcegraph from 'sourcegraph'

export const queryGraphQL = async <T = IQuery>(query: string, variables: object = {}): Promise<T> => {
    const { data, errors }: IGraphQLResponseRoot = await sourcegraph.commands.executeCommand(
        'queryGraphQL',
        query,
        variables
    )
    if (errors && errors.length > 0) {
        throw new Error(errors.map(error => error.message).join('\n'))
    }
    return (data as any) as T
}
