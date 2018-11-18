require('dotenv').config()

const Podcast = require('podcast');
const AWS = require('aws-sdk');

const yamlFront = require('yaml-front-matter');
const path = require('path');

const bucketName = process.env.S3_BUCKET_NAME;

AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const s3 = new AWS.S3();
const cloudFront = new AWS.CloudFront();

const feed = new Podcast({
    title: 'Underground Collectif Podcast',
    description: 'House Garage & Soulful podcast from Paris with love',
    feed_url: 'http://static.undergroundcollectif.fr/rss.xml',
    site_url: 'http://www.undergroundcollectif.fr/',
    image_url: 'http://static.undergroundcollectif.fr/podcast_cover.png',
    author: 'Underground Collectif',
    language: 'en',
    categories: ['Music'],
    pubDate: new Date(),
    ttl: '60',
    itunesAuthor: 'Underground Collectif',
    itunesSubtitle: 'House Garage & Soulful podcast',
    itunesSummary: 'House Garage & Soulful podcast from Paris with love',
    itunesOwner: { name: 'Underground Collectif', email:'undergroundcollectif@gmail.com' },
    itunesExplicit: false,
    itunesCategory: {
        "text": "Music",
    },
    itunesImage: 'http://static.undergroundcollectif.fr/podcast_cover.png'
});

s3.listObjectsV2({
    Bucket: bucketName,
    Prefix : 'underground_collectif',
}).promise().then(data => (
    data.Contents.filter(object => path.extname(object.Key) == '.md')
)).then(objects => (
    Promise.all(objects.map(object => s3.getObject({
        Bucket: bucketName,
        Key: object.Key,
    }).promise().then(data => {
        const config = yamlFront.loadFront(data.Body);

        return s3.headObject({
            Bucket: bucketName,
            Key: config.key,
        }).promise().then(data => ({
            ...config,
            size: data.ContentLength,
        }));
    })))
)).then(episodes => episodes.filter(episode => (
    Date.parse(episode.pubDate) <= new Date()
))).then(episodes => episodes.sort((a, b) => {

    if (a.pubDate === b.pubDate) {
        return 0;
    }

    return a.pubDate < b.pubDate ? -1 : 1;
})).then(episodes => episodes.forEach(episode => {

    const file = 'http://static.undergroundcollectif.fr/'+episode.key;

    feed.addItem({
        title: episode.title,
        description: episode.__content,
        url: file,
        categories: ['house music','garage', 'soulful', 'djset'], // optional - array of item categories
        date: episode.pubDate,
        enclosure : {
            url:file,
            size: episode.size
        },
        itunesAuthor: episode.author,
        itunesExplicit: false,
        itunesSubtitle: episode.subtitle,
        itunesSummary: '',
        itunesDuration: episode.duration,
        itunesKeywords: ['house music','garage', 'soulful', 'djset']
    });
})).then(() => (
    s3.putObject({
        Body: feed.buildXml(),
        Bucket: bucketName,
        Key: 'rss.xml',
    }).promise()
)).then(() => {
    cloudFront.createInvalidation({
        DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
        InvalidationBatch: {
            CallerReference: new Date().valueOf().toString(),
            Paths: {
                Quantity: 1,
                Items: [
                    '/rss.xml',
                ]
            }
        },
    }).promise()
});
