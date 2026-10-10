// Kept in sync with the API and OpenAPI by the backend pagination contract test.
export const paginationPolicy = Object.freeze({
  firstPage: 1,
  defaultLimit: 20,
  maxPage: 1000,
  maxLimit: 50
})

export const PUBLIC_LISTINGS_PAGE_SIZE = paginationPolicy.defaultLimit
export const EXPLORE_PAGE_SIZE = 10
