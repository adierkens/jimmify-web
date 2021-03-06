/*
Functionality related to the search results page, mainly polling for the
query answer, selecting the loading message, loading the recently answered
questions, and stripe interactions when the question is deep in the queue
*/

app.search = {
    // keep track of the id of the current query that is being answered
    CURRENT_QUERY_ID: -1,
    // list of messages to display to users while waiting for search results
    LOADING_MESSAGES: [
        "Don't worry, Jimmy is a certified search engine. Your results will appear here when he finishes them.",
        "Jimmy might be sleeping on the job... but we're sure he'll get to your question when someone wakes him up.",
        "Jimmy's working up a sweat answering questions. He will get to yours soon!"
    ],
    // reset looping search variable states, such as timers and poll loops
    resetSearchState: function() {
        app.search.CURRENT_QUERY_ID = -1;
        if (app.search.timerInterval) {
            clearInterval(app.search.timerInterval);
        }
        app.search.timerInterval = false;
    },
    // Return a random element from LOADING_MESSAGES
    getRandomLoadingMessage: function() {
        var messageNum = Math.floor(Math.random() * app.search.LOADING_MESSAGES.length);
        return app.search.LOADING_MESSAGES[messageNum];
    },
    // Start results joke timer while waiting
    timerInterval: false,
    resultsStartCounter: function() {
        var timer = 0;
        if(app.search.timerInterval == false){
            app.search.timerInterval = setInterval(function(){
                ++timer;
                $("#timer").text(timer);
            }, 1000);
        }
    },
    //poll for a reponse after the given delay in milliseconds
    pollAfterDelay: function(queryId, delay) {
        var prevQueryId = app.search.CURRENT_QUERY_ID;
        setTimeout(function(){
            // if the poll count changed during the delay, there was most likely
            // a new query so this polling loop should end
            if (prevQueryId == app.search.CURRENT_QUERY_ID && prevQueryId == queryId) {
                app.search.checkResponse(queryId, false);
            }
        }, delay);
    },
    //get the time in milliseconds that should be waited before
    //polling based on the given position in the question queue
    getPollDelayTime: function(position) {
        if (position < 20) {
            // check every 10 seconds if question in top 20 queue positions
            return 10 * 1000;
        } else {
            // otherwise check after 5 * (position + 1) seconds up to 20 minutes
            return Math.min((position + 1) * 5 * 1000, 20 * 60 * 1000);
        }
    },
    //return the answer to the user and stop polling
    returnAnswer: function(answer) {
        $(".results").text(answer); //put answer in card
        $(".loading").removeClass("loading"); //remove loading dots
        $("#num-results").text("1"); //set number of search results to 1 instead of 0
        app.search.resetSearchState();
    },
    // get the question text for the given queryId either from the cookie
    // or from the server, then set display the question text on the results
    // page. if fetching from the server, update the question text cookie
    setQuestionText: function(queryId) {
        var queryText;
        var cachedQueries = JSON.parse(Cookies.get("queryText"));

        if (cachedQueries[queryId]) {
            queryText = cachedQueries[queryId];
            $("#search-question").text(queryText);
            // set the contents of the search box and card to be query
            $(".search-box-input").val(queryText);
        } else {
            $.ajax({
                contentType: "application/json",
                data: JSON.stringify({
                    key: queryId
                }),
                method: 'POST',
                url: "/api/question",
                success: function(data) {
                    data = JSON.parse(data);
                    if (data.status) {
                        queryText = data.text;
                        updateCachedQueries(queryId, queryText);
                        // display question text
                        $("#search-question").text(queryText);
                        // set the contents of the search box and card to be query
                        $(".search-box-input").val(queryText);
                    } else {
                        queryText = "Uh oh...";
                        $("#search-question").text(queryText);
                        app.search.returnAnswer("Sadly, Jimmy couldn't find your question. Try refreshing the page or asking another one!");
                    }
                },
                error: function(e) {
                    queryText = "Uh oh...";
                    $("#search-question").text(queryText);
                    app.search.returnAnswer("Sadly, Jimmy couldn't find your question. Try refreshing the page or asking another one!");
                }
            })
        }
    },
    //check to see if the answer has
    checkResponse: function(queryId, bumpError) {
        if (queryId) {
            //We have an ID to check
            $.ajax({
                contentType: "application/json",
                data: JSON.stringify({
                    key: parseInt(queryId),
                }),
                method: 'POST',
                url: "/api/check",
                success: function(data) {
                    data = JSON.parse(data);
                    if (data.status) {
                        // We have an answer
                        var answer = data.answer;
                        app.search.returnAnswer(data.answer);
                        // display links from the response
                        var links = data.list;
                        if (links && links.length > 0) {
                            $("#result-links-container").show();
                            $("#recent-container").hide();
                            $("#jimmy-bump-container").hide();
                            insertTemplate("resultLinks", "#result-links-container", {"links": links});
                        }
                    } else {
                        app.search.pollAfterDelay(queryId, app.search.getPollDelayTime(data.position));
                        app.search.loadJimmyBump(data.position, bumpError);
                    }
                },
                error: function(e) {
                    console.log(e);
                }
            });
        }
    },
    // get the list of recent questions in the server queue and render them as
    // list of cards on the search results page
    loadRecentQuestions: function() {
        $.ajax({
            url: "/api/recent",
            success: function(data) {
                data = JSON.parse(data);
                if (data.status) {
                    // collect only search results from the recent queue items
                    var recentSearches = [];
                    for (var i = 0; i < data.recents.length; i++) {
                        var recentSearch = data.recents[i];
                        if (recentSearch.type == "search" && recentSearch.text && recentSearch.answer) {
                            recentSearches.push(recentSearch);
                        }
                    }
                    // only render if there are recent search results
                    if (recentSearches.length) {
                        insertTemplate("recentCards", "#recent-container", {"recents": recentSearches});
                    }
                }
            },
            error: function(e) {
                console.log(e);
            }
        })
    },
    // If the query is deep into the queue give them an ad
    // that allows them to pay
    loadJimmyBump: function(position, bumpError) {
        if (position > 20 || bumpError) {
            if($("#jimmy-bump-container").children().length == 0 || bumpError) {
                // Render pay dialog
                insertTemplate("jimmyBump", "#jimmy-bump-container",
                {"position": position, "bumpError": bumpError});

                // Configure Stripe pay button
                var handler = StripeCheckout.configure({
                    key: "pk_live_HBOwxIhB3SGzIwMWg2QIm5i3",
                    image: "/img/icon.png",
                    locale: "auto",
                    token: function(token) {
                        // You can access the token ID with `token.id`.
                        // Get the token ID to your server-side code for use.
                        var hash = window.location.hash.substr(1);
                        var queryId = Number(decodeURIComponent(hash.substring(2)));
                        insertTemplate("jimmyBump", "#jimmy-bump-container",
                        {"paid": true, "position": 0});
                        $('#stripe-pay-btn').hide();
                        $.ajax({
                            contentType: "application/json",
                            data: JSON.stringify({
                                key: parseInt(queryId),
                                token: token.id,
                            }),
                            method: 'POST',
                            url: "/api/charge",
                            success: function(data) {
                                data = JSON.parse(data);
                                if (data.status) {
                                    $('.payment-processing').fadeOut('slow', function() {
                                        $('.payment-complete').css("display", "flex").hide().fadeIn('slow');
                                    });
                                } else {
                                    app.search.checkResponse(queryId, true);
                                }
                            },
                            error: function(e) {
                                console.log(e);
                            }
                        });
                    }
                });

                // clear pay button event handlers
                $("#stripe-pay-btn").off("click");
                $(window).off("popstate");

                $("#stripe-pay-btn").on("click", function(e) {
                    // Open Checkout with further options:
                    handler.open({
                        name: "Jimmy Search",
                        description: "Move your search to top of queue",
                        amount: 100
                    });
                    e.preventDefault();
                });

                // Close Checkout on page navigation:
                $(window).on("popstate", function() {
                    handler.close();
                });
            }
        }
    }
}
