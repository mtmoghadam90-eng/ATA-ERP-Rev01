-- The end user and the two key people, linked rather than named by their id.
--
-- The project form's pickers write a customer id, and it was being written into
-- the *name* columns (endUser, financialContact, technicalContact) while the
-- foreign keys beside them stayed NULL. Nothing that read those fields could
-- make sense of them: the project profile panel resolved them as ids against a
-- list it did not have and printed «مشخص نشده» for all three, and the Excel
-- export wrote out raw ids.
--
-- The form now writes the id to the foreign key and the name beside it. This
-- repairs what is already stored, and only where it is certain: a name column
-- holding a value that is exactly the id of an existing customer.
UPDATE p
SET p.[endUserCustomerId] = c.[id],
    p.[endUser]           = c.[companyName]
FROM [projects] p
INNER JOIN [customers] c ON c.[id] = p.[endUser]
WHERE p.[endUserCustomerId] IS NULL;

UPDATE p
SET p.[financialContactId] = c.[id],
    p.[financialContact]   = COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(c.[firstName], ' ', c.[lastName]))), ''), c.[companyName])
FROM [projects] p
INNER JOIN [customers] c ON c.[id] = p.[financialContact]
WHERE p.[financialContactId] IS NULL;

UPDATE p
SET p.[technicalContactId] = c.[id],
    p.[technicalContact]   = COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(c.[firstName], ' ', c.[lastName]))), ''), c.[companyName])
FROM [projects] p
INNER JOIN [customers] c ON c.[id] = p.[technicalContact]
WHERE p.[technicalContactId] IS NULL;
