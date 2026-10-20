-- Fill in the message a notice is about, for notices written before
-- 20261010000000 recorded it. Without this, every notice already in somebody's
-- inbox on the day that shipped opened the project's feed with nothing
-- expanded, which reads as the feature not working. Only matches that can be
-- made exactly are written; anything ambiguous stays NULL and still opens its
-- project, as it always did. Reply notices need nothing here: they are resolved
-- through itemId when the list is read.

-- «ارجاع جدید»: the referral raised for this very person on this project, at
-- the moment of the notice (the notice is written right after the commit).
UPDATE n SET n.[activityId] = (
  SELECT TOP 1 a.[id]
  FROM [dbo].[project_referrals] r
  JOIN [dbo].[project_activities] a ON a.[id] = r.[activityId]
  JOIN [dbo].[project_category_groups] g ON g.[id] = a.[groupId]
  WHERE r.[assignedToUserId] = n.[userId]
    AND g.[projectId] = n.[projectId]
    AND a.[createdAt] BETWEEN DATEADD(minute, -10, n.[createdAt]) AND DATEADD(minute, 10, n.[createdAt])
  ORDER BY ABS(DATEDIFF(second, a.[createdAt], n.[createdAt]))
)
FROM [dbo].[module_notifications] n
WHERE n.[activityId] IS NULL AND n.[itemId] IS NULL AND n.[projectId] IS NOT NULL
  AND n.[title] = N'ارجاع جدید';

-- «پیام جدید در …»: a message in that category of that project, by somebody
-- else, at the moment of the notice.
UPDATE n SET n.[activityId] = (
  SELECT TOP 1 a.[id]
  FROM [dbo].[project_activities] a
  JOIN [dbo].[project_category_groups] g ON g.[id] = a.[groupId]
  WHERE g.[projectId] = n.[projectId]
    AND n.[title] = N'پیام جدید در ' + g.[categoryName]
    AND (a.[authorUserId] IS NULL OR a.[authorUserId] <> n.[userId])
    AND a.[createdAt] BETWEEN DATEADD(minute, -10, n.[createdAt]) AND DATEADD(minute, 10, n.[createdAt])
  ORDER BY ABS(DATEDIFF(second, a.[createdAt], n.[createdAt]))
)
FROM [dbo].[module_notifications] n
WHERE n.[activityId] IS NULL AND n.[itemId] IS NULL AND n.[projectId] IS NOT NULL
  AND n.[title] LIKE N'پیام جدید در %';

-- A referral's later notices (done, reopened, text or deadline changed): only
-- when exactly one referral on that project involves this person, so the
-- message named cannot be the wrong one.
UPDATE n SET n.[activityId] = (
  SELECT MIN(r.[activityId])
  FROM [dbo].[project_referrals] r
  JOIN [dbo].[project_activities] a ON a.[id] = r.[activityId]
  JOIN [dbo].[project_category_groups] g ON g.[id] = a.[groupId]
  WHERE g.[projectId] = n.[projectId]
    AND (r.[assignedToUserId] = n.[userId] OR r.[assignedByUserId] = n.[userId])
)
FROM [dbo].[module_notifications] n
WHERE n.[activityId] IS NULL AND n.[itemId] IS NULL AND n.[projectId] IS NOT NULL
  AND n.[title] IN (N'اتمام کار ارجاع', N'بازگشایی ارجاع', N'ویرایش متن ارجاع', N'تعیین مهلت ارجاع', N'حذف مهلت ارجاع')
  AND (
    SELECT COUNT(DISTINCT r.[activityId])
    FROM [dbo].[project_referrals] r
    JOIN [dbo].[project_activities] a ON a.[id] = r.[activityId]
    JOIN [dbo].[project_category_groups] g ON g.[id] = a.[groupId]
    WHERE g.[projectId] = n.[projectId]
      AND (r.[assignedToUserId] = n.[userId] OR r.[assignedByUserId] = n.[userId])
  ) = 1;
