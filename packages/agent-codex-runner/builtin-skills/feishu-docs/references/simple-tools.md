# Simple Tools

Use this file for the lower-complexity tools whose schemas are straightforward.

## search-user

Purpose:

- search users by name keyword
- get `open_id` for mentions or owner filters

Schema:

- `query: string` required
- `page_size: integer` optional, range `1..100`, default `20`
- `page_token: string` optional

## get-user

Purpose:

- fetch user details from a known `open_id`

Schema:

- `open_id: string`

## fetch-file

Purpose:

- fetch content behind a file-like resource token

Schema:

- `resource_token: string` required
- `type: string` required

## get-comments

Purpose:

- list comments for a document

Schema:

- `doc_id: string` required
- `comment_type: string` optional
- `page_size: integer` optional
- `page_token: string` optional

## list-docs

Purpose:

- list direct child docs under a wiki node or My Library

Schema:

- `doc_id: string` optional when `my_library == true`, otherwise required
- `my_library: boolean` optional
- `page_size: integer` optional
- `page_token: string` optional

Rules:

- this API returns only direct children
- recurse yourself if you need deeper levels
- do not invent wiki structure
