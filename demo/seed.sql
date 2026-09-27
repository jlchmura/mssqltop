-- Demo databases for mssqltop: a small store (ShopDemo) and a reporting warehouse (Warehouse).
-- Run by demo/entrypoint.sh with sqlcmd; $(DemoPassword) is the SA password, reused for the demo logins.
:on error exit
SET NOCOUNT ON;
GO

-- Start clean in case an earlier seed was interrupted.
IF DB_ID('ShopDemo') IS NOT NULL
BEGIN
	ALTER DATABASE ShopDemo SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
	DROP DATABASE ShopDemo;
END;
IF DB_ID('Warehouse') IS NOT NULL
BEGIN
	ALTER DATABASE Warehouse SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
	DROP DATABASE Warehouse;
END;
GO

CREATE DATABASE ShopDemo;
ALTER DATABASE ShopDemo SET RECOVERY SIMPLE;
CREATE DATABASE Warehouse;
ALTER DATABASE Warehouse SET RECOVERY SIMPLE;
GO

-- One login per application, like a real server. CHECK_POLICY is off because these are throwaway demo passwords.
IF SUSER_ID('web_app') IS NULL CREATE LOGIN web_app WITH PASSWORD = '$(DemoPassword)', CHECK_POLICY = OFF;
IF SUSER_ID('reporting') IS NULL CREATE LOGIN reporting WITH PASSWORD = '$(DemoPassword)', CHECK_POLICY = OFF;
IF SUSER_ID('etl_service') IS NULL CREATE LOGIN etl_service WITH PASSWORD = '$(DemoPassword)', CHECK_POLICY = OFF;
IF SUSER_ID('analyst') IS NULL CREATE LOGIN analyst WITH PASSWORD = '$(DemoPassword)', CHECK_POLICY = OFF;
-- What mssqltop itself should connect as: the only permission it needs.
IF SUSER_ID('mssqltop') IS NULL CREATE LOGIN mssqltop WITH PASSWORD = '$(DemoPassword)', CHECK_POLICY = OFF;
GRANT VIEW SERVER STATE TO mssqltop;
GO

------------------------------------------------------------------------------------------------------------------------
-- ShopDemo
------------------------------------------------------------------------------------------------------------------------
USE ShopDemo;
GO

CREATE TABLE dbo.Customers (
	CustomerId int IDENTITY PRIMARY KEY,
	Name nvarchar(100) NOT NULL,
	Email nvarchar(200) NOT NULL,
	Region varchar(20) NOT NULL,
	CreatedAt datetime2 NOT NULL
);

CREATE TABLE dbo.Products (
	ProductId int IDENTITY PRIMARY KEY,
	Name nvarchar(100) NOT NULL,
	Category varchar(30) NOT NULL,
	Price decimal(10, 2) NOT NULL,
	Stock int NOT NULL
);

CREATE TABLE dbo.Orders (
	OrderId int IDENTITY PRIMARY KEY,
	CustomerId int NOT NULL,
	OrderDate datetime2 NOT NULL,
	Status varchar(12) NOT NULL,
	Total decimal(12, 2) NOT NULL
);

CREATE TABLE dbo.OrderLines (
	OrderLineId bigint IDENTITY PRIMARY KEY,
	OrderId int NOT NULL,
	ProductId int NOT NULL,
	Quantity int NOT NULL,
	UnitPrice decimal(10, 2) NOT NULL
);
GO

-- Numbers 1..1,000,000 to generate rows from.
CREATE TABLE #n (i int PRIMARY KEY);
INSERT #n (i)
SELECT TOP (1000000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL))
FROM sys.all_objects a CROSS JOIN sys.all_objects b;

INSERT dbo.Products (Name, Category, Price, Stock)
SELECT CONCAT(c.Category, N' item ', n.i), c.Category, 5 + ABS(CHECKSUM(NEWID())) % 49500 / 100.0, 1000
FROM #n n
JOIN (VALUES (0, 'Electronics'), (1, 'Books'), (2, 'Garden'), (3, 'Toys'), (4, 'Kitchen'), (5, 'Sports'),
	(6, 'Clothing'), (7, 'Music'), (8, 'Office'), (9, 'Outdoors'), (10, 'Health'), (11, 'Automotive')) c (k, Category)
	ON c.k = n.i % 12
WHERE n.i <= 2000;

INSERT dbo.Customers (Name, Email, Region, CreatedAt)
SELECT CONCAT(N'Customer ', i), CONCAT(N'customer', i, N'@example.com'),
	CHOOSE(1 + i % 5, 'North', 'South', 'East', 'West', 'Central'), DATEADD(day, -(i % 1000), SYSUTCDATETIME())
FROM #n WHERE i <= 20000;

-- 300k orders over the last two years, three lines each.
INSERT dbo.Orders (CustomerId, OrderDate, Status, Total)
SELECT 1 + ABS(CHECKSUM(NEWID())) % 20000, DATEADD(minute, -(ABS(CHECKSUM(NEWID())) % 1051200), SYSUTCDATETIME()),
	CASE i % 10 WHEN 0 THEN 'Cancelled' WHEN 1 THEN 'Pending' ELSE 'Shipped' END, 0
FROM #n WHERE i <= 300000;

INSERT dbo.OrderLines (OrderId, ProductId, Quantity, UnitPrice)
SELECT o.OrderId, 1 + ABS(CHECKSUM(NEWID())) % 2000, 1 + ABS(CHECKSUM(NEWID())) % 5, 0
FROM dbo.Orders o CROSS JOIN (VALUES (1), (2), (3)) l (k);

UPDATE l SET UnitPrice = p.Price FROM dbo.OrderLines l JOIN dbo.Products p ON p.ProductId = l.ProductId;

UPDATE o SET Total = s.Total
FROM dbo.Orders o
JOIN (SELECT OrderId, SUM(Quantity * UnitPrice) AS Total FROM dbo.OrderLines GROUP BY OrderId) s ON s.OrderId = o.OrderId;

CREATE INDEX IX_Orders_Customer ON dbo.Orders (CustomerId) INCLUDE (OrderDate, Status, Total);
CREATE INDEX IX_OrderLines_Order ON dbo.OrderLines (OrderId) INCLUDE (ProductId, Quantity, UnitPrice);
GO

CREATE USER web_app FOR LOGIN web_app;
CREATE USER reporting FOR LOGIN reporting;
CREATE USER etl_service FOR LOGIN etl_service;
CREATE USER analyst FOR LOGIN analyst;
ALTER ROLE db_datareader ADD MEMBER web_app;
ALTER ROLE db_datawriter ADD MEMBER web_app;
ALTER ROLE db_datareader ADD MEMBER reporting;
ALTER ROLE db_datareader ADD MEMBER etl_service;
ALTER ROLE db_datawriter ADD MEMBER etl_service;
ALTER ROLE db_datareader ADD MEMBER analyst;
GRANT EXECUTE TO web_app, reporting, etl_service;
GO

-- Storefront: many short calls.
CREATE PROCEDURE dbo.GetProduct @ProductId int AS
SELECT ProductId, Name, Category, Price, Stock FROM dbo.Products WHERE ProductId = @ProductId;
GO

CREATE PROCEDURE dbo.GetCustomerOrders @CustomerId int AS
SELECT TOP (20) o.OrderId, o.OrderDate, o.Status, o.Total, COUNT(*) AS Lines
FROM dbo.Orders o
JOIN dbo.OrderLines l ON l.OrderId = o.OrderId
WHERE o.CustomerId = @CustomerId
GROUP BY o.OrderId, o.OrderDate, o.Status, o.Total
ORDER BY o.OrderDate DESC;
GO

CREATE PROCEDURE dbo.PlaceOrder @CustomerId int, @ProductId int, @Quantity int AS
SET XACT_ABORT ON;
DECLARE @OrderId int, @Price decimal(10, 2);
BEGIN TRAN;
UPDATE dbo.Products SET Stock = Stock - @Quantity, @Price = Price WHERE ProductId = @ProductId;
INSERT dbo.Orders (CustomerId, OrderDate, Status, Total) VALUES (@CustomerId, SYSUTCDATETIME(), 'Pending', @Price * @Quantity);
SET @OrderId = SCOPE_IDENTITY();
INSERT dbo.OrderLines (OrderId, ProductId, Quantity, UnitPrice) VALUES (@OrderId, @ProductId, @Quantity, @Price);
COMMIT;
GO

-- Reports: big scans, parallel plans and memory grants.
CREATE PROCEDURE dbo.SalesByCategory @Days int AS
SELECT p.Category, DATEFROMPARTS(YEAR(o.OrderDate), MONTH(o.OrderDate), 1) AS Month,
	COUNT(DISTINCT o.CustomerId) AS Customers, SUM(l.Quantity * l.UnitPrice) AS Revenue
FROM dbo.Orders o
JOIN dbo.OrderLines l ON l.OrderId = o.OrderId
JOIN dbo.Products p ON p.ProductId = l.ProductId
WHERE o.OrderDate >= DATEADD(day, -@Days, SYSUTCDATETIME()) AND o.Status <> 'Cancelled'
GROUP BY p.Category, DATEFROMPARTS(YEAR(o.OrderDate), MONTH(o.OrderDate), 1)
ORDER BY Revenue DESC;
GO

CREATE PROCEDURE dbo.TopCustomers @Region varchar(20) AS
SELECT TOP (100) c.CustomerId, c.Name, SUM(o.Total) AS Spend, RANK() OVER (ORDER BY SUM(o.Total) DESC) AS SpendRank
FROM dbo.Customers c
JOIN dbo.Orders o ON o.CustomerId = c.CustomerId
WHERE c.Region = @Region
GROUP BY c.CustomerId, c.Name
ORDER BY Spend DESC;
GO

-- Inventory sync: holds row locks on a whole category, so storefront calls pile up behind it.
CREATE PROCEDURE dbo.RestockCategory @Category varchar(30), @HoldSeconds int AS
SET XACT_ABORT ON;
DECLARE @Delay char(8) = CONVERT(char(8), DATEADD(second, @HoldSeconds, 0), 108);
BEGIN TRAN;
UPDATE dbo.Products SET Stock = Stock + 100 WHERE Category = @Category;
WAITFOR DELAY @Delay;
COMMIT;
GO

------------------------------------------------------------------------------------------------------------------------
-- Warehouse
------------------------------------------------------------------------------------------------------------------------
USE Warehouse;
GO

CREATE TABLE dbo.SalesFact (
	OrderId int NOT NULL,
	OrderDate date NOT NULL,
	Category varchar(30) NOT NULL,
	Region varchar(20) NOT NULL,
	Quantity int NOT NULL,
	Revenue decimal(12, 2) NOT NULL,
	LoadedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE USER etl_service FOR LOGIN etl_service;
CREATE USER reporting FOR LOGIN reporting;
ALTER ROLE db_owner ADD MEMBER etl_service;
ALTER ROLE db_datareader ADD MEMBER reporting;
GO

-- Nightly ETL: copies a week of orders per call. The CHECKPOINT flushes it to disk, so writes show on the
-- Database I/O chart (otherwise they sit in memory for a long while under the SIMPLE recovery model).
CREATE PROCEDURE dbo.LoadSalesFact @DaysAgo int AS
INSERT dbo.SalesFact (OrderId, OrderDate, Category, Region, Quantity, Revenue)
SELECT o.OrderId, CAST(o.OrderDate AS date), p.Category, c.Region, l.Quantity, l.Quantity * l.UnitPrice
FROM ShopDemo.dbo.Orders o
JOIN ShopDemo.dbo.OrderLines l ON l.OrderId = o.OrderId
JOIN ShopDemo.dbo.Products p ON p.ProductId = l.ProductId
JOIN ShopDemo.dbo.Customers c ON c.CustomerId = o.CustomerId
WHERE o.OrderDate >= DATEADD(day, -@DaysAgo - 7, SYSUTCDATETIME())
	AND o.OrderDate < DATEADD(day, -@DaysAgo, SYSUTCDATETIME());

CHECKPOINT;

IF (SELECT SUM(rows) FROM sys.partitions WHERE object_id = OBJECT_ID('dbo.SalesFact') AND index_id IN (0, 1)) > 2000000
	TRUNCATE TABLE dbo.SalesFact;
GO

------------------------------------------------------------------------------------------------------------------------
-- Marker checked by the container healthcheck: seeding is complete.
------------------------------------------------------------------------------------------------------------------------
USE ShopDemo;
GO
CREATE TABLE dbo.SeedInfo (SeededAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
INSERT dbo.SeedInfo DEFAULT VALUES;
GO
